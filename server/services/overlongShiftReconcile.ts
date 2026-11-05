/**
 * One-time (idempotent) cleanup for forgotten punch-outs: shifts recorded far
 * longer than the max-shift limit (almost always a forgotten clock-out that the
 * old live-clock ingest closed with the NEXT day's clock-in, producing a ~24h
 * shift), PLUS shifts an older version of this tool already capped-and-COUNTED
 * at the limit.
 *
 * Per the attendance rule, a forgotten punch-out is NOT a worked shift: the clock
 * is stopped and the shift becomes a MISSING PUNCH (0 hours). So for each target
 * this sets a placeholder clock-out at the max-shift mark, zeroes the hours,
 * marks the punch `missing_clockout`, and raises/repurposes a `missing_clockout`
 * exception so a manager can enter the real clock-out. It never touches a shift
 * within the limit, and re-running is safe (a shift that's already a missing
 * punch is skipped).
 *
 * Preview with { apply: false } (no writes) before { apply: true }.
 */
import { db } from "../db";
import { storage } from "../storage";
import { punchLogs, attendanceExceptions } from "@shared/schema";
import { and, isNotNull, sql, eq, inArray } from "drizzle-orm";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES } from "../policyEngine";
import { recomputeLedger } from "../attendanceLedger";
import { MISSING_CLOCKOUT_STATUS } from "../punchHours";
import { resolveEmployeeTimezone, localWorkDate } from "./punchOverlap";

export interface OverlongItem {
  punchId: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  clockIn: string;
  originalClockOut: string;
  originalHours: number;
  cappedClockOut: string;
  cappedHours: number;
}

export interface OverlongReconcileResult {
  applied: boolean;
  thresholdHours: number;
  found: number;
  fixed: number;
  employeesAffected: number;
  items: OverlongItem[];
}

export async function reconcileOverlongShifts(opts: { apply: boolean }): Promise<OverlongReconcileResult> {
  const scanHours = DEFAULT_ATTENDANCE_RULES.maxShiftHours;

  // 1) Never-capped forgotten punch-outs: closed shifts whose raw span exceeds
  //    the default max (re-checked against each employee's own policy below).
  const spanRows = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        isNotNull(punchLogs.clockIn),
        isNotNull(punchLogs.clockOut),
        sql`EXTRACT(EPOCH FROM (${punchLogs.clockOut} - ${punchLogs.clockIn})) > ${scanHours * 3600}`,
      ),
    );

  // 2) Shifts an OLDER version of this tool (or the old auto-split) already
  //    capped and COUNTED at the limit: identified by a linked `max_shift_split`
  //    exception. They now sit at exactly the limit (so the span scan misses
  //    them) yet still count hours — convert them to missing punches too.
  const splitEx = await db
    .select({ punchLogId: attendanceExceptions.punchLogId })
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.type, "max_shift_split"));
  const splitIds = Array.from(
    new Set(splitEx.map((e) => e.punchLogId).filter((x): x is string => !!x)),
  );
  const cappedRows = splitIds.length
    ? await db.select().from(punchLogs).where(inArray(punchLogs.id, splitIds))
    : [];

  // 3) Cross-midnight shifts: a closed shift whose clock-in and clock-out fall
  //    on different LOCAL calendar days. For a non-overnight employee this is
  //    almost always a forgotten punch-out (an evening punch mistaken for a new
  //    clock-in, then "closed" by the next morning's clock-in). All Ahava
  //    locations are US Eastern, so the day boundary is computed in that zone
  //    here as a cheap pre-filter; the per-employee timezone + overnight flag are
  //    re-checked in the loop below.
  const crossDayRows = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        isNotNull(punchLogs.clockIn),
        isNotNull(punchLogs.clockOut),
        // clock_in/out are `timestamp without time zone` holding the UTC instant,
        // so interpret as UTC first, then convert to Eastern, before taking the
        // local date. (A single AT TIME ZONE would wrongly treat the value as
        // already-Eastern.) The per-employee timezone is re-checked in the loop.
        sql`(${punchLogs.clockOut} AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date <> (${punchLogs.clockIn} AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date`,
      ),
    );

  // Merge all sets, de-duplicated by punch id.
  const byId = new Map<string, (typeof spanRows)[number]>();
  for (const r of spanRows) byId.set(r.id, r);
  for (const r of cappedRows) byId.set(r.id, r);
  for (const r of crossDayRows) byId.set(r.id, r);
  const splitIdSet = new Set(splitIds);

  const items: OverlongItem[] = [];
  const employees = new Set<string>();
  let fixed = 0;

  for (const p of byId.values()) {
    if (!p.clockIn || !p.clockOut) continue;
    // Already a missing punch — nothing to do (keeps re-runs idempotent).
    if (p.status === MISSING_CLOCKOUT_STATUS) continue;

    const inT = new Date(p.clockIn as any);
    const outT = new Date(p.clockOut as any);
    const user = await storage.getUser(p.employeeId);
    if (!user) continue;

    const policy = await getEffectivePolicy(user.companyId, p.employeeId, "attendance", user);
    const rules = policy?.rules || DEFAULT_ATTENDANCE_RULES;
    const maxShiftHours = rules.maxShiftHours ?? DEFAULT_ATTENDANCE_RULES.maxShiftHours;
    const spanHours = (outT.getTime() - inT.getTime()) / (1000 * 60 * 60);
    const wasCapped = splitIdSet.has(p.id);

    // A cross-midnight shift counts only for a non-overnight employee (checked
    // with their real location timezone, not the Eastern pre-filter).
    let crossDay = false;
    if (spanHours <= maxShiftHours && !wasCapped) {
      const tz = await resolveEmployeeTimezone(p.employeeId);
      if (localWorkDate(inT, tz) < localWorkDate(outT, tz)) {
        crossDay = !(await storage.isOvernightShiftsAllowed(p.employeeId));
      }
    }

    // Act only on genuine forgotten punch-outs: a span over this employee's
    // limit, a shift the old tool capped-and-counted (now at the limit), or a
    // cross-midnight shift for a non-overnight employee.
    if (spanHours <= maxShiftHours && !wasCapped && !crossDay) continue;

    // Placeholder clock-out: the max-shift mark, but never beyond the shift's
    // own recorded clock-out (a sub-13h cross-midnight shift keeps its recorded
    // end). A marker, not a real punch-out.
    const cap = new Date(Math.min(inT.getTime() + maxShiftHours * 60 * 60 * 1000, outT.getTime()));
    const employeeName =
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || p.employeeId;
    employees.add(p.employeeId);
    items.push({
      punchId: p.id,
      employeeId: p.employeeId,
      employeeName,
      workDate: p.workDate,
      clockIn: inT.toISOString(),
      originalClockOut: outT.toISOString(),
      originalHours: Math.round((Number(p.hoursWorked) || spanHours) * 100) / 100,
      cappedClockOut: cap.toISOString(),
      cappedHours: 0, // marked a missing punch — no hours counted
    });

    if (opts.apply) {
      await storage.updatePunchLog(p.id, {
        clockOut: cap,
        roundedClockOut: cap,
        hoursWorked: 0,
        status: MISSING_CLOCKOUT_STATUS,
        breakStartedAt: null,
      });
      const reason = crossDay
        ? `Shift crossed midnight (clock-in and clock-out on different days) for an employee who doesn't ` +
          `work overnight — almost certainly a forgotten punch-out (an evening punch read as a new clock-in). ` +
          `Recorded as a MISSING PUNCH (no hours counted). Enter the real clock-out, and add the following ` +
          `shift if the employee clocked in again.`
        : `Shift was ${Math.round(spanHours)}h — over the ${maxShiftHours}h max with no real punch-out ` +
          `(a forgotten clock-out). Recorded as a MISSING PUNCH (no hours counted); the clock-out shown is ` +
          `only a ${maxShiftHours}h placeholder. Enter the real clock-out to record the actual hours.`;
      // Reuse an existing exception on this punch (e.g. the old max_shift_split
      // one) so the row isn't duplicated; otherwise raise a fresh one.
      const existing = await db
        .select()
        .from(attendanceExceptions)
        .where(eq(attendanceExceptions.punchLogId, p.id));
      const reusable = existing.find(
        (e) => e.type === "max_shift_split" || e.type === "missing_clockout",
      );
      if (reusable) {
        await storage.updateAttendanceException(reusable.id, {
          type: "missing_clockout",
          reason,
          exceptionTime: cap,
          status: "pending",
        });
      } else {
        const ex = await storage.createAttendanceException({
          employeeId: p.employeeId,
          exceptionDate: p.workDate,
          exceptionTime: cap,
          type: "missing_clockout",
          reason,
          status: "pending",
        });
        if (ex?.id) await storage.updateAttendanceException(ex.id, { punchLogId: p.id });
      }
      await recomputeLedger(p.employeeId, [p.workDate]);
      fixed++;
    }
  }

  return {
    applied: opts.apply,
    thresholdHours: scanHours,
    found: items.length,
    fixed,
    employeesAffected: employees.size,
    items,
  };
}
