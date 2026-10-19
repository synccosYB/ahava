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
    "TimeZone=0",
    "Realtime=1",
    "Encrypt=0",
  ].join("\n");
}

/** Standard positive ACK for a data upload. Devices treat "OK" as "accepted". */
export function ackOk(count?: number): string {
  return typeof count === "number" ? `OK: ${count}` : "OK";
}
