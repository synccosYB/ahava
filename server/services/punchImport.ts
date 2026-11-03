/**
 * Bulk punch (timesheet) importer — used for the one-time migration off the old
 * fingerprint-clock software. Each row is ONE completed shift:
 *
 *   Clock # | Name (ignored) | Clock In | Clock Out
 *
 * where Clock In / Clock Out are local wall-clock datetimes ("YYYY-MM-DD HH:MM",
 * 24-hour). The old report is per-employee In/Out punches spanning every machine
 * (the "Site" column); we flatten it to shift rows before import.
 *
 * Behavior:
 *  - Matches the employee by Clock # = stored employee number (scoped to the
 *    operational company), exactly like the employee importer.
 *  - Builds clock-in/out timestamps in the EMPLOYEE'S LOCATION timezone (falls
 *    back to the company/default zone) so a punch lands on the right calendar
 *    day and hour regardless of where the server runs.
 *  - Idempotent / safe to re-run: a shift whose (employee, clock-in minute)
 *    already exists is skipped, so re-uploading the report as each machine is
 *    switched over only adds the NEW punches — never doubles.
 *  - source = "manager" (an admin-entered correction), status "completed",
 *    approved. Rows with no clock-out, an unmatched Clock #, or an unparsable
 *    time are skipped with a reason.
 */
import XLSX from "xlsx";
import { and, eq, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  userEmploymentProfiles,
  users,
  employeeLocations,
  locations,
  punchLogs,
} from "../../shared/schema";
import { resolveTimezone, DEFAULT_TIMEZONE } from "../../shared/timezone";

export const COMPANY_NAME = "Ahava Medical Center";

export interface PunchImportSummary {
  rowsParsed: number;
  /** Completed shifts (in + out) created. */
  imported: number;
  /** Open clock-ins (in, no out) pre-loaded so a later live clock-out pairs. */
  openImported: number;
  /** Shifts skipped because an identical punch already existed (idempotent). */
  duplicates: number;
  skipped: { row: number; reason: string }[];
  /** Distinct employees that got at least one punch. */
  employeesTouched: number;
  /** Clock #s in the file that matched no employee (import these people first). */
  unmatchedClockNumbers: string[];
}

function pick(row: Record<string, unknown>, candidates: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) byKey.set(norm(k), v);
  for (const c of candidates) {
    const v = byKey.get(norm(c));
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Parse "YYYY-MM-DD HH:MM[:SS]" (optionally with a 'T') as wall-clock parts. */
function parseLocalParts(
  raw: string,
): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = String(raw)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const parts = { y: +y, mo: +mo, d: +d, h: +h, mi: +mi };
  if (parts.mo < 1 || parts.mo > 12 || parts.d < 1 || parts.d > 31) return null;
  if (parts.h > 23 || parts.mi > 59) return null;
  return parts;
}

/** Offset (ms) that must be subtracted from a naive-UTC instant so the given
 * wall-clock time is interpreted IN `tz`. Uses Intl only (no tz library). */
function tzOffsetMs(instant: Date, tz: string): number {
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
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second,
  );
  return asUTC - instant.getTime();
}

/** Convert a wall-clock time in `tz` to the correct UTC Date. */
function wallToUtc(
  p: { y: number; mo: number; d: number; h: number; mi: number },
  tz: string,
): Date {
  const naiveUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  // Apply the offset twice so DST boundaries settle.
  let ts = naiveUTC - tzOffsetMs(new Date(naiveUTC), tz);
  ts = naiveUTC - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Local calendar date (YYYY-MM-DD) of a UTC instant, rendered in `tz`. */
function localDateStr(instant: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(instant); // en-CA => YYYY-MM-DD
}

export async function importPunchesFromBuffer(
  buffer: Buffer,
): Promise<PunchImportSummary> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("The spreadsheet has no sheets.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[sheetName],
    { defval: null },
  );

  // Resolve the operational company (same scoping as the employee importer).
  const allCompanies = await storage.getAllCompanies();
  const company = allCompanies.find(
    (c) => c.name.trim().toLowerCase() === COMPANY_NAME.toLowerCase(),
  );
  if (!company) {
    throw new Error(
      `Operational company "${COMPANY_NAME}" not found — import employees first.`,
    );
  }

  // Clock # -> userId, scoped to this company.
  const profiles = await db
    .select({
      userId: userEmploymentProfiles.userId,
      employeeNumber: userEmploymentProfiles.employeeNumber,
    })
    .from(userEmploymentProfiles)
    .innerJoin(users, eq(users.id, userEmploymentProfiles.userId))
    .where(eq(users.companyId, company.id));
  const userIdByNumber = new Map<string, string>();
  for (const p of profiles) {
    if (p.employeeNumber) userIdByNumber.set(p.employeeNumber.trim(), p.userId);
  }

  // userId -> timezone (first location's zone, else company/default).
  const locRows = await db
    .select({ userId: employeeLocations.userId, tz: locations.timezone })
    .from(employeeLocations)
    .innerJoin(locations, eq(locations.id, employeeLocations.locationId));
  const tzByUser = new Map<string, string>();
  for (const r of locRows) {
    if (!tzByUser.has(r.userId)) {
      tzByUser.set(r.userId, resolveTimezone(r.tz, DEFAULT_TIMEZONE));
    }
  }

  let imported = 0;
  let openImported = 0;
  let duplicates = 0;
  const skipped: { row: number; reason: string }[] = [];
  const touched = new Set<string>();
  const unmatched = new Set<string>();

  let rowNum = 1;
  for (const row of rows) {
    rowNum++;
    const clockNumber = pick(row, ["Clock #", "Clock#", "Id", "ID", "Clock Number"]);
    const clockInRaw = pick(row, ["Clock In", "ClockIn", "Time In", "In"]);
    const clockOutRaw = pick(row, ["Clock Out", "ClockOut", "Time Out", "Out"]);

    if (!clockNumber) {
      skipped.push({ row: rowNum, reason: "missing Clock #" });
      continue;
    }
    const userId = userIdByNumber.get(clockNumber);
    if (!userId) {
      unmatched.add(clockNumber);
      skipped.push({ row: rowNum, reason: `no employee with Clock # ${clockNumber}` });
      continue;
    }
    if (!clockInRaw) {
      skipped.push({ row: rowNum, reason: `missing clock-in (Clock # ${clockNumber})` });
      continue;
    }
    const inParts = parseLocalParts(clockInRaw);
    if (!inParts) {
      skipped.push({ row: rowNum, reason: `unparsable clock-in (Clock # ${clockNumber}): "${clockInRaw}"` });
      continue;
    }

    const tz = tzByUser.get(userId) ?? DEFAULT_TIMEZONE;
    const clockIn = wallToUtc(inParts, tz);
    const workDate = localDateStr(clockIn, tz);

    // Idempotent: skip when a punch for this employee already starts at this
    // exact minute — open or closed. (Re-uploading only adds genuinely new ones.)
    const minuteStart = new Date(Math.floor(clockIn.getTime() / 60000) * 60000);
    const minuteEnd = new Date(minuteStart.getTime() + 60000 - 1);
    const sameStart = await db
      .select({ id: punchLogs.id })
      .from(punchLogs)
      .where(
        and(
          eq(punchLogs.employeeId, userId),
          gte(punchLogs.clockIn, minuteStart),
          lte(punchLogs.clockIn, minuteEnd),
        ),
      )
      .limit(1);
    if (sameStart.length > 0) {
      duplicates++;
      continue;
    }

    // OPEN shift (clock-in, no clock-out): pre-load it so a later LIVE clock-out
    // on the new machine pairs with it automatically — the whole point of the
    // mid-week switchover. The DB allows only ONE open punch per employee, so if
    // they already have one open (e.g. a punch the live clock mis-recorded),
    // leave it for a manual fix instead of failing.
    if (!clockOutRaw) {
      const openExisting = await db
        .select({ id: punchLogs.id })
        .from(punchLogs)
        .where(
          and(
            eq(punchLogs.employeeId, userId),
            isNotNull(punchLogs.clockIn),
            isNull(punchLogs.clockOut),
          ),
        )
        .limit(1);
      if (openExisting.length > 0) {
        skipped.push({ row: rowNum, reason: `Clock # ${clockNumber} already has an open shift; open clock-in not loaded (fix by hand)` });
        continue;
      }
      try {
        await storage.createPunchLog({
          employeeId: userId,
          workDate,
          clockIn,
          clockOut: null,
          hoursWorked: null,
          status: "in-progress",
          source: "manager",
          approved: true,
          notes: "Imported open clock-in (mid-week switchover)",
        });
        openImported++;
        touched.add(userId);
      } catch {
        skipped.push({ row: rowNum, reason: `Clock # ${clockNumber} open clock-in could not be loaded (already open?); fix by hand` });
      }
      continue;
    }

    // COMPLETED shift: both in and out.
    const outParts = parseLocalParts(clockOutRaw);
    if (!outParts) {
      skipped.push({ row: rowNum, reason: `unparsable clock-out (Clock # ${clockNumber}): "${clockOutRaw}"` });
      continue;
    }
    const clockOut = wallToUtc(outParts, tz);
    if (clockOut.getTime() <= clockIn.getTime()) {
      skipped.push({ row: rowNum, reason: `clock-out not after clock-in (Clock # ${clockNumber})` });
      continue;
    }
    const hoursWorked = (clockOut.getTime() - clockIn.getTime()) / 3600000;
    await storage.createPunchLog({
      employeeId: userId,
      workDate,
      clockIn,
      clockOut,
      hoursWorked,
      status: "completed",
      source: "manager",
      approved: true,
      notes: "Imported from prior time-clock system",
    });
    imported++;
    touched.add(userId);
  }

  return {
    rowsParsed: rows.length,
    imported,
    openImported,
    duplicates,
    skipped,
    employeesTouched: touched.size,
    unmatchedClockNumbers: Array.from(unmatched),
  };
}
