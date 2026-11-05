// ADMS / "iclock" push-protocol helpers (the wire format ZKTeco-family clocks,
// including the Compumatic XLS Bio v2, speak when "Server Mode: ADMS" is set).
//
// The protocol is plain text over HTTP(S):
//   • Device handshake:  GET  /iclock/cdata?SN=<serial>&options=all...
//        → server replies with a "registry"/options block (text/plain).
//   • Punch upload:      POST /iclock/cdata?SN=<serial>&table=ATTLOG
//        → body is tab-separated punch lines; server replies "OK: <count>".
//   • Command poll:      GET  /iclock/getrequest?SN=<serial>
//        → server replies "OK" (no commands) or queued command lines.
//
// We keep this intentionally small and well-logged: on first real-device bring-up
// the verbose request log is how we confirm/adjust behaviour on site.

import { timingSafeEqual } from "node:crypto";

// ADMS punch uploads affect payroll. A serial number is a public identifier,
// not authentication. Require a secret supplied by an authenticated HTTPS
// ingress (e.g. a trusted reverse proxy injecting X-Ahava-ADMS-Key). The
// physical clock's ability to send credentials must be verified per model.
export function isValidAdmsToken(configured: string | undefined, supplied: string | undefined): boolean {
  if (!configured || configured.length < 32 || !supplied) return false;
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface AttendancePunch {
  /** The device's local enrolled user-number (what the clock calls the person). */
  deviceUserId: string;
  /** Device-reported local time string, verbatim, e.g. "2026-10-20 08:03:11". */
  timeRaw: string;
  /** Punch state the employee selected on the device (0..5), if any. */
  status: string;
  /** Verify mode (1 = fingerprint, etc.), if present. */
  verify: string;
  /** The untouched original line, kept for audit. */
  rawLine: string;
}

/**
 * Parse an ATTLOG upload body into punches. Each non-empty line is one punch,
 * tab-separated: `pin \t YYYY-MM-DD HH:MM:SS \t status \t verify \t ...`.
 * Parsing is deliberately lenient — we never want a stray column to drop a real
 * punch — and anything unparseable is skipped (and visible in the raw log).
 */
export function parseAttlog(body: string): AttendancePunch[] {
  if (!body) return [];
  const punches: AttendancePunch[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split("\t");
    const deviceUserId = (cols[0] ?? "").trim();
    const timeRaw = (cols[1] ?? "").trim();
    if (!deviceUserId || !timeRaw) continue; // not a punch row
    punches.push({
      deviceUserId,
      timeRaw,
      status: (cols[2] ?? "").trim(),
      verify: (cols[3] ?? "").trim(),
      rawLine: line,
    });
  }
  return punches;
}

// --- Fingerprint "cloud brain" parsing (Phase 2 Harvest) -------------------
//
// When a clock uploads its user + fingerprint data (on connect, or in reply to a
// DATA QUERY command) it POSTs tab/space-separated key=value lines to
// /iclock/cdata. Firmware varies, so we parse leniently and case-insensitively.
//   • User line:   `USER PIN=1  Name=John  Pri=0 ...`
//   • Template:    legacy  `FP PIN=1  FID=0  Size=1998  Valid=1  TMP=<base64>`
//                  newer   `BIODATA Pin=1  No=0  Index=0  Type=1  Valid=1  Tmp=<base64>`

export interface DeviceUserRecord {
  pin: string;
  name: string | null;
}

export interface DeviceFingerprintRecord {
  pin: string;
  fingerIndex: number;
  size: number | null;
  valid: boolean;
  template: string; // base64 vendor blob
  format: "FP" | "BIODATA";
}

export interface BioUpload {
  users: DeviceUserRecord[];
  fingerprints: DeviceFingerprintRecord[];
}

// Parse the key=value pairs on one line into a case-insensitive lookup. Values
// can contain `=` (base64 padding never does, but be safe) so split on the first.
function kvPairs(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of rest.split(/\t|\s{1,}/)) {
    const eq = tok.indexOf("=");
    if (eq <= 0) continue;
    out[tok.slice(0, eq).toLowerCase()] = tok.slice(eq + 1);
  }
  return out;
}

/**
 * Parse a device data upload body into user + fingerprint records. Lines that
 * aren't USER/FP/BIODATA are ignored. Returns whatever it recognizes — never
 * throws — so a stray line can't drop real data.
 */
export function parseBioUpload(body: string): BioUpload {
  const users: DeviceUserRecord[] = [];
  const fingerprints: DeviceFingerprintRecord[] = [];
  if (!body) return { users, fingerprints };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sp = line.indexOf(" ");
    const tag = (sp > 0 ? line.slice(0, sp) : line).toUpperCase();
    const rest = sp > 0 ? line.slice(sp + 1) : "";
    const kv = kvPairs(rest);

    if (tag === "USER") {
      const pin = kv.pin ?? "";
      if (pin) users.push({ pin, name: kv.name ? decodeURIComponent(kv.name.replace(/\+/g, " ")) : null });
      continue;
    }
    if (tag === "FP" || tag === "BIODATA") {
      // BIODATA is only a fingerprint when Type is absent or 1 (0/1 = fingerprint
      // across firmwares); skip face/palm/vein rows.
      if (tag === "BIODATA" && kv.type !== undefined && kv.type !== "0" && kv.type !== "1") continue;
      const pin = kv.pin ?? "";
      const template = kv.tmp ?? "";
      if (!pin || !template) continue;
      const idxRaw = kv.fid ?? kv.index ?? kv.no ?? "0";
      const fingerIndex = Number.parseInt(idxRaw, 10);
      const size = kv.size ? Number.parseInt(kv.size, 10) : null;
      fingerprints.push({
        pin,
        fingerIndex: Number.isFinite(fingerIndex) ? fingerIndex : 0,
        size: Number.isFinite(size as number) ? (size as number) : null,
        valid: kv.valid === undefined ? true : kv.valid === "1" || kv.valid.toLowerCase() === "true",
        template,
        format: tag === "FP" ? "FP" : "BIODATA",
      });
    }
  }
  return { users, fingerprints };
}

// --- Fingerprint cloud brain: Distribute (push templates DOWN to a clock) ---
//
// Build the `DATA UPDATE ...` commands that tell a clock to create a user and
// store a fingerprint template. Queued per device and handed over on getrequest.
// We emit the template in the SAME format it was harvested in (FP vs BIODATA).

/** Command to create/update a user on the device. */
export function buildUserInfoCommand(pin: string, name: string | null): string {
  const safeName = (name ?? "").replace(/[\t\r\n]/g, " ").slice(0, 24);
  return `DATA UPDATE USERINFO PIN=${pin}\tName=${safeName}\tPri=0\tPasswd=\tCard=0\tGrp=1\tTZ=0`;
}

/** Command to store one fingerprint template on the device. */
export function buildFingerprintUpdateCommand(input: {
  pin: string;
  fingerIndex: number;
  size: number | null;
  valid: boolean;
  template: string; // base64 vendor blob (decrypted)
  format: "FP" | "BIODATA" | string;
}): string {
  const valid = input.valid ? 1 : 0;
  if (input.format === "BIODATA") {
    return (
      `DATA UPDATE BIODATA Pin=${input.pin}\tNo=${input.fingerIndex}\tIndex=${input.fingerIndex}` +
      `\tValid=${valid}\tDuress=0\tType=1\tMajorVer=0\tMinorVer=0\tFormat=0\tTmp=${input.template}`
    );
  }
  // Legacy FINGERTMP.
  const size = input.size ?? input.template.length;
  return `DATA UPDATE FINGERTMP PIN=${input.pin}\tFID=${input.fingerIndex}\tSize=${size}\tValid=${valid}\tTMP=${input.template}`;
}

/** Pull the `table` kind (ATTLOG / OPERLOG / ...) from the request query. */
export function tableKind(query: Record<string, unknown>): string {
  const t = query?.table ?? query?.Table ?? "";
  return String(t).toUpperCase();
}

/** Extract the device serial (SN) from the request query, if present. */
export function serialFromQuery(query: Record<string, unknown>): string | null {
  const sn = query?.SN ?? query?.sn ?? "";
  const s = String(sn).trim();
  return s.length > 0 ? s : null;
}

// All Ahava locations are US Eastern. The clock's displayed time comes from the
// `TimeZone` we send here (minutes offset from GMT, negative west). Hard-coding
// 0 pinned every clock to UTC — ~4–5 hours ahead — and the device re-synced to
// it every poll, so a manual time never held. Getting this right also matters
// for recorded punch times now: ingest parses the device's reported local time
// (parseDevicePunchTime) in this zone, so the clock's displayed time must match
// the location's wall clock.
const CLOCK_DISPLAY_TZ = "America/New_York";

/**
 * Current UTC offset, in whole minutes, for an IANA zone (negative west of
 * GMT) — computed live so the value follows daylight-saving automatically
 * (EST = -300, EDT = -240). Intl only, no tz dependency.
 */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  // `|| 0` normalizes a -0 (GMT itself) to 0.
  return Math.round((asUTC - at.getTime()) / 60000) || 0;
}

/**
 * Convert a device-reported local time string ("YYYY-MM-DD HH:MM[:SS]", the
 * ATTLOG format) into the correct UTC instant, interpreting the wall-clock
 * parts in the clock's location timezone `tz`. The clock reports LOCAL time
 * (what its screen shows — Eastern for every Ahava site), so a naive parse
 * would be hours off. The offset is applied twice so a DST boundary settles
 * (mirrors the punch importer's wallToUtc). Returns null for an unparseable
 * string so the caller can fall back to server time rather than drop the punch.
 */
export function parseDevicePunchTime(raw: string, tz: string): Date | null {
  const m = String(raw)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const Y = +y, Mo = +mo, D = +d, H = +h, Mi = +mi, S = s ? +s : 0;
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31 || H > 23 || Mi > 59 || S > 59) return null;
  // naiveUTC treats the wall-clock parts as if they were UTC; subtracting the
  // zone's offset (negative west of GMT) shifts to the true UTC instant:
  // utc = wall − offset.
  const naiveUTC = Date.UTC(Y, Mo - 1, D, H, Mi, S);
  let ts = naiveUTC - tzOffsetMinutes(tz, new Date(naiveUTC)) * 60000;
  ts = naiveUTC - tzOffsetMinutes(tz, new Date(ts)) * 60000;
  return new Date(ts);
}

/**
 * The options/registry block a device expects in reply to its initial
 * `GET /iclock/cdata?...options=all` handshake. These values tell the clock how
 * to behave: poll in realtime, keep transmitting, don't encrypt. Conservative,
 * broadly-compatible defaults.
 */
export function buildOptionsResponse(serial: string): string {
  return [
    `GET OPTION FROM: ${serial}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransFlag=1000000000",
    `TimeZone=${tzOffsetMinutes(CLOCK_DISPLAY_TZ)}`,
    "Realtime=1",
    "Encrypt=0",
  ].join("\n");
}

/** Standard positive ACK for a data upload. Devices treat "OK" as "accepted". */
export function ackOk(count?: number): string {
  return typeof count === "number" ? `OK: ${count}` : "OK";
}
