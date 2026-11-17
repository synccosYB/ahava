/**
 * Back-pay orchestration: given an attendance correction that landed on a day
 * already paid in a finalized export, compute the pay owed (or clawed back) by
 * recomputing the affected workweek from CURRENT punches against the SAME frozen
 * policy snapshot the source export was built with.
 *
 * The pure arithmetic lives in computeBackpayDelta (backpayRecompute.ts); this
 * module gathers the inputs from the DB and reconstructs the frozen policy the
 * same way payroll verification/drift does (server/services/reconciliation.ts),
 * so a back-pay delta is consistent with how the period was originally exported.
 */
import { storage } from "../storage";
import { getEffectivePolicy } from "../policyEngine";
import { buildPayCalcPolicy, workweekStartFor, type PayCalcPolicy } from "../payrollEngine";
import { computePunchHoursWorked } from "../punchHours";
import { computeBackpayDelta, type BackpayDelta, type PaidDaySplit } from "./backpayRecompute";
import type { PayrollBackpayItem, PayrollExport, User } from "@shared/schema";

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}

export interface BackpayComputation {
  delta: BackpayDelta;
  /** The workweek days (YYYY-MM-DD) the recompute covered. */
  affectedDates: string[];
}

/**
 * Reconstruct the policy a source export was built with: prefer the snapshot
 * frozen on its batch records (so a closed period recomputes identically even
 * after the live policy changed), falling back to the employee's current
 * effective policy only for fully-legacy rows. Mirrors
 * computePayrollVerification's reconstruction.
 */
function reconstructFrozenPolicy(
  records: Array<{
    otThresholdDaily: number | null;
    doubleTimeThresholdDaily: number | null;
    overtimeMultiplier: number | null;
    doubleTimeMultiplier: number | null;
    autoCalculateOt: boolean | null;
    overtimeEnabled: boolean | null;
    doubleTimeEnabled: boolean | null;
    holidayOtExclusion: boolean | null;
    otThresholdWeekly: number | null;
    weeklyOvertimeEnabled: boolean | null;
    workweekStartDay: number | null;
  }>,
  resolved: PayCalcPolicy,
): PayCalcPolicy {
  const sample = records.find((r) => r.otThresholdDaily != null || r.overtimeMultiplier != null);
  if (!sample) return resolved;
  const hasWeeklySnapshot = records.some(
    (r) => r.otThresholdWeekly != null || r.weeklyOvertimeEnabled != null || r.workweekStartDay != null,
  );
  return {
    ...resolved,
    otThresholdDaily: sample.otThresholdDaily ?? resolved.otThresholdDaily,
    doubleTimeThresholdDaily: sample.doubleTimeThresholdDaily ?? resolved.doubleTimeThresholdDaily,
    overtimeMultiplier: sample.overtimeMultiplier ?? resolved.overtimeMultiplier,
    doubleTimeMultiplier: sample.doubleTimeMultiplier ?? resolved.doubleTimeMultiplier,
    autoCalculateOT: sample.autoCalculateOt ?? resolved.autoCalculateOT,
    overtimeEnabled: sample.overtimeEnabled ?? resolved.overtimeEnabled,
    doubleTimeEnabled: sample.doubleTimeEnabled ?? resolved.doubleTimeEnabled,
    holidayOtExclusion: sample.holidayOtExclusion ?? resolved.holidayOtExclusion,
    otThresholdWeekly: sample.otThresholdWeekly ?? resolved.otThresholdWeekly,
    weeklyOvertimeEnabled: hasWeeklySnapshot
      ? (sample.weeklyOvertimeEnabled ?? resolved.weeklyOvertimeEnabled)
      : false,
    workweekStartDay: sample.workweekStartDay ?? resolved.workweekStartDay,
  };
}

/**
 * Compute the back-pay owed for `employee` on `workDate` after a correction,
 * relative to what `sourceExport` already paid. Returns null when the source
 * export paid nothing for this employee (no baseline to reconcile against).
 */
export async function computeBackpayForCorrection(params: {
  employee: User;
  workDate: string;
  sourceExport: PayrollExport;
}): Promise<BackpayComputation | null> {
  const { employee, workDate, sourceExport } = params;

  const allRecords = await storage.getPayrollBatchRecords(sourceExport.id);
  const records = allRecords.filter(
    (r) => r.employeeId === employee.id && r.recordType === "attendance",
  );
  if (records.length === 0) return null;

  const [att, pay, pto] = await Promise.all([
    getEffectivePolicy(employee.companyId, employee.id, "attendance", employee),
    getEffectivePolicy(employee.companyId, employee.id, "payroll", employee),
    getEffectivePolicy(employee.companyId, employee.id, "pto", employee),
  ]);
  const resolved = buildPayCalcPolicy(att?.rules, pay?.rules, pto?.rules, {
    attendance: att?.version ?? null,
    payroll: pay?.version ?? null,
  });
  const policy = reconstructFrozenPolicy(records, resolved);

  // The affected workweek (by the frozen workweek-start), scoped to the days the
  // source export actually paid for this employee, plus the corrected day itself
  // (which may be a brand-new day the export never paid — baseline 0 for it).
  const weekStart = workweekStartFor(workDate, policy.workweekStartDay);
  const inWeek = (d: string) => workweekStartFor(d, policy.workweekStartDay) === weekStart;

  const paidByDate = new Map<string, PaidDaySplit>();
  for (const r of records) {
    if (!inWeek(r.workDate)) continue;
    const cur = paidByDate.get(r.workDate) ?? { regularHours: 0, overtimeHours: 0, doubleTimeHours: 0 };
    paidByDate.set(r.workDate, {
      regularHours: cur.regularHours + (r.regularHours ?? 0),
      overtimeHours: cur.overtimeHours + (r.overtimeHours ?? 0),
      doubleTimeHours: cur.doubleTimeHours + (r.doubleTimeHours ?? 0),
    });
  }

  const dates = new Set<string>([...paidByDate.keys()]);
  if (inWeek(workDate)) dates.add(workDate);

  // Corrected hours per day from CURRENT punches. A day with an open/incomplete
  // punch can't be recomputed yet, so it's skipped (no delta contributed).
  const correctedDays: { date: string; hours: number; isHoliday?: boolean }[] = [];
  for (const date of dates) {
    const punches = await storage.getAttendancesForUserOnDate(employee.id, date);
    let hours = 0;
    let incomplete = false;
    for (const p of punches) {
      const h = computePunchHoursWorked(p);
      if (h === null) {
        incomplete = true;
        break;
      }
      hours += h;
    }
    if (incomplete) continue;
    const rec = records.find((r) => r.workDate === date);
    const isHoliday = rec?.isHoliday ?? false;
    correctedDays.push({ date, hours, isHoliday });
  }

  const rateRecord = records.find((r) => r.hourlyRate != null) ?? records[0];
  const delta = computeBackpayDelta({
    correctedDays,
    paidByDate,
    policy,
    rate: {
      hourlyRate: rateRecord?.hourlyRate ?? null,
      overtimeMultiplier: rateRecord?.overtimeMultiplier ?? null,
      doubleTimeMultiplier: rateRecord?.doubleTimeMultiplier ?? null,
    },
  });

  return { delta, affectedDates: [...dates].sort() };
}

/**
 * After a correction that touched one or more finalized exports has been applied
 * to the timesheet, record the pay owed/clawed-back as PENDING back-pay item(s)
 * for ADMIN approval. Idempotent per (employee, source export, recomputed week):
 * a fresh correction on the same week SUPERSEDES the prior pending item, so the
 * recompute (which already reflects every correction so far) is never double
 * counted. A zero net delta creates nothing (and clears a now-moot prior item).
 *
 * Best-effort and post-commit: the correction itself is already applied, so a
 * failure here must not undo it — callers log loudly and surface that back-pay
 * needs attention rather than failing the whole request.
 */
export async function routeBackpayForCorrection(params: {
  employee: User;
  workDate: string;
  sourceExports: PayrollExport[];
  attendanceExceptionId: string | null;
  punchLogId: string | null;
  requestedBy: string;
  reasonPrefix?: string;
}): Promise<PayrollBackpayItem[]> {
  const created: PayrollBackpayItem[] = [];
  const priorPending = await storage.getPendingPayrollBackpayItemsForEmployee(params.employee.id);

  for (const src of dedupeById(params.sourceExports)) {
    const comp = await computeBackpayForCorrection({
      employee: params.employee,
      workDate: params.workDate,
      sourceExport: src,
    });
    if (!comp) continue;

    // Supersede prior pending items from this same source export whose day falls
    // in the week we just recomputed (the new delta already accounts for them).
    for (const p of priorPending) {
      if (p.sourcePayrollExportId === src.id && comp.affectedDates.includes(p.workDate)) {
        await storage.deletePayrollBackpayItem(p.id);
      }
    }

    if (comp.delta.isZero) continue;

    const span =
      comp.affectedDates.length > 0
        ? `${comp.affectedDates[0]}..${comp.affectedDates[comp.affectedDates.length - 1]}`
        : params.workDate;
    const item = await storage.createPayrollBackpayItem({
      employeeId: params.employee.id,
      workDate: params.workDate,
      sourcePayrollExportId: src.id,
      attendanceExceptionId: params.attendanceExceptionId,
      punchLogId: params.punchLogId,
      reason:
        `${params.reasonPrefix ?? "Correction after payroll was sent"} — ` +
        `week ${span} recomputed against export ${src.startDate}..${src.endDate}.`,
      regularHours: comp.delta.regularHours,
      overtimeHours: comp.delta.overtimeHours,
      doubleTimeHours: comp.delta.doubleTimeHours,
      hourlyRate: comp.delta.hourlyRate,
      overtimeMultiplier: comp.delta.overtimeMultiplier,
      doubleTimeMultiplier: comp.delta.doubleTimeMultiplier,
      status: "pending",
      requestedBy: params.requestedBy,
    });
    created.push(item);
  }
  return created;
}
