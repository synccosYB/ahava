/**
 * One-time (idempotent) cleanup for shifts that were recorded far longer than the
 * max-shift limit — almost always a forgotten punch-out that the old live-clock
 * ingest closed with the NEXT day's clock-in, producing a ~24h shift.
 *
 * For each closed shift whose span exceeds the employee's max-shift limit (13h),
 * this caps the clock-out at the limit, recomputes hours, and raises a
 * `max_shift_split` exception that records the ORIGINAL (mis-recorded) clock-out
 * so a manager can set the real time and add the following shift. It never
 * touches shifts within the limit, and re-running it is safe (a capped shift no
 * longer exceeds the limit, so it isn't picked up again).
 *
 * Preview with { apply: false } (no writes) before { apply: true }.
 */
import { db } from "../db";
import { storage } from "../storage";
import { punchLogs } from "@shared/schema";
import { and, isNotNull, sql } from "drizzle-orm";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES } from "../policyEngine";
import { resolvePayCalcPolicy, splitDailyHours } from "../payrollEngine";
import { recomputeLedger } from "../attendanceLedger";
import { computeBreakElapsedMinutes } from "../punchHours";
import { computeAutoClockOutValues } from "./policyEnforcement";

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
  // Cheap first pass: closed shifts whose raw span exceeds the DEFAULT max. Each
  // candidate is then re-checked against the employee's own policy limit below.
  const scanHours = DEFAULT_ATTENDANCE_RULES.maxShiftHours;
  const rows = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        isNotNull(punchLogs.clockIn),
        isNotNull(punchLogs.clockOut),
        sql`EXTRACT(EPOCH FROM (${punchLogs.clockOut} - ${punchLogs.clockIn})) > ${scanHours * 3600}`,
      ),
    );

  const items: OverlongItem[] = [];
  const employees = new Set<string>();
  let fixed = 0;

  for (const p of rows) {
    const inT = new Date(p.clockIn as any);
    const outT = new Date(p.clockOut as any);
    const user = await storage.getUser(p.employeeId);
    if (!user) continue;

    const policy = await getEffectivePolicy(user.companyId, p.employeeId, "attendance", user);
    const rules = policy?.rules || DEFAULT_ATTENDANCE_RULES;
    const maxShiftHours = rules.maxShiftHours ?? DEFAULT_ATTENDANCE_RULES.maxShiftHours;
    const spanHours = (outT.getTime() - inT.getTime()) / (1000 * 60 * 60);
    if (spanHours <= maxShiftHours) continue; // within this employee's policy limit

    const roundingRule = rules.roundingRule ?? DEFAULT_ATTENDANCE_RULES.roundingRule;
    const roundingInterval = rules.roundingIntervalMinutes ?? DEFAULT_ATTENDANCE_RULES.roundingIntervalMinutes;
    const roundedIn = new Date((p.roundedClockIn ?? p.clockIn) as any);
    const cap = new Date(inT.getTime() + maxShiftHours * 60 * 60 * 1000);
    const breakMinutes = (p.breakMinutes || 0) + computeBreakElapsedMinutes(p.breakStartedAt, cap);

    const { autoClockOutActual, autoClockOutRounded, hoursWorked } = computeAutoClockOutValues({
      actualClockIn: inT,
      roundedClockIn: roundedIn,
      breakMinutes,
      autoClockOutAfterHours: maxShiftHours,
      roundingRule,
      roundingIntervalMinutes: roundingInterval,
    });

    const employeeName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || p.employeeId;
    employees.add(p.employeeId);
    items.push({
      punchId: p.id,
      employeeId: p.employeeId,
      employeeName,
      workDate: p.workDate,
      clockIn: inT.toISOString(),
      originalClockOut: outT.toISOString(),
      originalHours: Math.round(spanHours * 100) / 100,
      cappedClockOut: autoClockOutActual.toISOString(),
      cappedHours: hoursWorked,
    });

    if (opts.apply) {
      const payCalc = await resolvePayCalcPolicy(user);
      const { status } = splitDailyHours(hoursWorked, payCalc);
      await storage.updatePunchLog(p.id, {
        clockOut: autoClockOutActual,
        roundedClockOut: autoClockOutRounded,
        hoursWorked,
        status,
        breakMinutes,
        breakStartedAt: null,
      });
      const ex = await storage.createAttendanceException({
        employeeId: p.employeeId,
        exceptionDate: p.workDate,
        exceptionTime: autoClockOutActual,
        type: "max_shift_split",
        reason:
          `Shift was ${Math.round(spanHours)}h — over the ${maxShiftHours}h max, almost certainly a forgotten ` +
          `punch-out that got closed by the next clock-in. The clock-out was capped at the ${maxShiftHours}h mark ` +
          `and is UNVERIFIED. The original (mis-recorded) clock-out was ${outT.toISOString()}; confirm the real ` +
          `clock-out and add the following shift if the employee clocked in again.`,
        status: "pending",
      });
      if (ex?.id) await storage.updateAttendanceException(ex.id, { punchLogId: p.id });
      void recomputeLedger(p.employeeId, [p.workDate]).catch(() => {});
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
