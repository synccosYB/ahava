/**
 * Recovery & reconciliation tools.
 *
 * These admin-only tools rebuild derived values from their source-of-truth
 * records using the SAME central hours engine the rest of the app uses, so a
 * data-drift problem can be detected and repaired without hand-editing the DB.
 *
 * Every tool follows the same contract:
 *   - a `compute*` function produces a read-only before/after diff (no writes),
 *   - an `apply*` function re-derives server-side and persists the corrected
 *     values, writing an audit-log entry for the bulk operation.
 *
 * The math itself is NOT defined here — it is consumed from the central engine
 * (`computePunchHoursWorked`, `computeTimeOffBalanceDetailed`) so reconciliation
 * can never introduce a new source of drift.
 */
import { db } from "../db";
import { storage } from "../storage";
import { timeOffBalances, punchLogs } from "@shared/schema";
import type { User } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { computePunchHoursWorked } from "../punchHours";
import { getEffectivePolicy } from "../policyEngine";
import { buildPayCalcPolicy, splitDailyHours, computeWeeklyHours, resolvePayCalcPolicy, DEFAULT_PAY_CALC_POLICY, type PayCalcPolicy } from "../payrollEngine";
import { writeAuditLog } from "./audit";
import { BALANCE_TRACKED_TIME_OFF_TYPES } from "@shared/schema";

const HOURS_EPSILON = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function userName(u: User | undefined): string {
  if (!u) return "Unknown";
  return `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Unknown";
}

// ---------------------------------------------------------------------------
// 1. Attendance hours / overtime reconciliation
// ---------------------------------------------------------------------------

export interface AttendanceDiffItem {
  punchLogId: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  storedHours: number;
  computedHours: number;
  hoursDelta: number;
  storedStatus: string;
  computedStatus: string;
}

export interface AttendanceReconciliationResult {
  startDate: string;
  endDate: string;
  scanned: number;
  drifted: number;
  items: AttendanceDiffItem[];
}

async function buildPolicyResolver() {
  const cache = new Map<string, PayCalcPolicy>();
  const userMap = new Map((await storage.getAllUsers()).map((u) => [u.id, u]));
  return {
    userMap,
    async policyFor(employeeId: string): Promise<PayCalcPolicy> {
      if (cache.has(employeeId)) return cache.get(employeeId)!;
      const u = userMap.get(employeeId);
      const policy = u ? await resolvePayCalcPolicy(u) : DEFAULT_PAY_CALC_POLICY;
      cache.set(employeeId, policy);
      return policy;
    },
  };
}

export async function computeAttendanceReconciliation(
  startDate: string,
  endDate: string,
): Promise<AttendanceReconciliationResult> {
  const punches = await storage.getAttendanceByDateRange(startDate, endDate);
  const { userMap, policyFor } = await buildPolicyResolver();

  const items: AttendanceDiffItem[] = [];
  let scanned = 0;

  for (const p of punches) {
    // Only finished punches yield a derived hours value. Leave in-progress /
    // malformed punches untouched.
    const computed = computePunchHoursWorked(p);
    if (computed === null) continue;
    scanned++;

    const stored = p.hoursWorked ?? 0;
    const policy = await policyFor(p.employeeId);
    const computedStatus = splitDailyHours(computed, policy).status;
    const storedStatus = p.status ?? "complete";

    const hoursDrift = Math.abs(stored - computed) > HOURS_EPSILON;
    const statusDrift =
      (storedStatus === "complete" || storedStatus === "overtime") &&
      storedStatus !== computedStatus;

    if (!hoursDrift && !statusDrift) continue;

    items.push({
      punchLogId: p.id,
      employeeId: p.employeeId,
      employeeName: userName(userMap.get(p.employeeId)),
      workDate: p.workDate,
      clockIn: p.clockIn ? new Date(p.clockIn).toISOString() : null,
      clockOut: p.clockOut ? new Date(p.clockOut).toISOString() : null,
      breakMinutes: p.breakMinutes || 0,
      storedHours: round2(stored),
      computedHours: round2(computed),
      hoursDelta: round2(computed - stored),
      storedStatus,
      computedStatus,
    });
  }

  items.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employeeName.localeCompare(b.employeeName));

  return { startDate, endDate, scanned, drifted: items.length, items };
}

export async function applyAttendanceReconciliation(
  punchLogIds: string[],
  actorUserId: string,
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ applied: number; skipped: number; changes: AttendanceDiffItem[] }> {
  const { userMap, policyFor } = await buildPolicyResolver();
  const changes: AttendanceDiffItem[] = [];
  let skipped = 0;

  for (const id of punchLogIds) {
    const p = await storage.getPunchLog(id);
    if (!p) {
      skipped++;
      continue;
    }
    const computed = computePunchHoursWorked(p);
    if (computed === null) {
      skipped++;
      continue;
    }
    const stored = p.hoursWorked ?? 0;
    const policy = await policyFor(p.employeeId);
    const computedStatus = splitDailyHours(computed, policy).status;
    const storedStatus = p.status ?? "complete";

    const hoursDrift = Math.abs(stored - computed) > HOURS_EPSILON;
    const statusDrift =
      (storedStatus === "complete" || storedStatus === "overtime") &&
      storedStatus !== computedStatus;
    if (!hoursDrift && !statusDrift) {
      skipped++;
      continue;
    }

    const update: { hoursWorked: number; status?: string } = { hoursWorked: round2(computed) };
    if (statusDrift) update.status = computedStatus;
    await storage.updatePunchLog(id, update);

    changes.push({
      punchLogId: p.id,
      employeeId: p.employeeId,
      employeeName: userName(userMap.get(p.employeeId)),
      workDate: p.workDate,
      clockIn: p.clockIn ? new Date(p.clockIn).toISOString() : null,
      clockOut: p.clockOut ? new Date(p.clockOut).toISOString() : null,
      breakMinutes: p.breakMinutes || 0,
      storedHours: round2(stored),
      computedHours: round2(computed),
      hoursDelta: round2(computed - stored),
      storedStatus,
      computedStatus,
    });
  }

  if (changes.length > 0) {
    await writeAuditLog({
      actorUserId,
      targetType: "reconciliation",
      targetId: "attendance",
      action: "reconciliation.attendance.applied",
      newValue: {
        appliedCount: changes.length,
        skipped,
        changes: changes.map((c) => ({
          punchLogId: c.punchLogId,
          employeeId: c.employeeId,
          workDate: c.workDate,
          storedHours: c.storedHours,
          computedHours: c.computedHours,
          storedStatus: c.storedStatus,
          computedStatus: c.computedStatus,
        })),
      },
      ...ctx,
    });
  }

  return { applied: changes.length, skipped, changes };
}

// ---------------------------------------------------------------------------
// 2. PTO balance rebuild
// ---------------------------------------------------------------------------

export interface PtoBucketDiff {
  type: string;
  storedTotal: number | null;
  storedUsed: number | null;
  computedTotal: number;
  computedUsed: number;
  totalDelta: number;
  usedDelta: number;
}

export interface PtoDiffItem {
  userId: string;
  employeeName: string;
  buckets: PtoBucketDiff[];
}

export interface PtoReconciliationResult {
  year: number;
  scanned: number;
  drifted: number;
  items: PtoDiffItem[];
}

export async function computePtoReconciliation(year: number): Promise<PtoReconciliationResult> {
  const users = (await storage.getAllUsers()).filter((u) => !u.deactivatedAt && u.role !== "kiosk");
  const items: PtoDiffItem[] = [];
  let scanned = 0;

  for (const u of users) {
    scanned++;
    let detailed;
    try {
      detailed = await storage.computeTimeOffBalanceDetailed(u.id);
    } catch {
      continue;
    }
    const stored = await storage.getTimeOffBalancesByUser(u.id, year);
    const storedByType = new Map(stored.map((b) => [b.type, b]));

    const buckets: PtoBucketDiff[] = [];
    for (const type of BALANCE_TRACKED_TIME_OFF_TYPES) {
      const computedBucket = detailed[type];
      const computedTotal = Math.round(computedBucket.total);
      const computedUsed = Math.round(computedBucket.used);
      const storedRow = storedByType.get(type);
      const storedTotal = storedRow ? storedRow.totalHours : null;
      const storedUsed = storedRow ? storedRow.usedHours : null;

      const totalDrift = storedTotal === null || storedTotal !== computedTotal;
      const usedDrift = storedUsed === null || storedUsed !== computedUsed;
      if (!totalDrift && !usedDrift) continue;

      buckets.push({
        type,
        storedTotal,
        storedUsed,
        computedTotal,
        computedUsed,
        totalDelta: computedTotal - (storedTotal ?? 0),
        usedDelta: computedUsed - (storedUsed ?? 0),
      });
    }

    if (buckets.length > 0) {
      items.push({ userId: u.id, employeeName: userName(u), buckets });
    }
  }

  items.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return { year, scanned, drifted: items.length, items };
}

export async function applyPtoReconciliation(
  userIds: string[],
  year: number,
  actorUserId: string,
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ applied: number; rowsWritten: number }> {
  let rowsWritten = 0;
  const appliedUsers: Array<{ userId: string; buckets: PtoBucketDiff[] }> = [];

  for (const userId of userIds) {
    let detailed;
    try {
      detailed = await storage.computeTimeOffBalanceDetailed(userId);
    } catch {
      continue;
    }
    const stored = await storage.getTimeOffBalancesByUser(userId, year);
    const storedByType = new Map(stored.map((b) => [b.type, b]));

    const buckets: PtoBucketDiff[] = [];
    for (const type of BALANCE_TRACKED_TIME_OFF_TYPES) {
      const computedBucket = detailed[type];
      const computedTotal = Math.round(computedBucket.total);
      const computedUsed = Math.round(computedBucket.used);
      const storedRow = storedByType.get(type);
      const storedTotal = storedRow ? storedRow.totalHours : null;
      const storedUsed = storedRow ? storedRow.usedHours : null;

      const totalDrift = storedTotal === null || storedTotal !== computedTotal;
      const usedDrift = storedUsed === null || storedUsed !== computedUsed;
      if (!totalDrift && !usedDrift) continue;

      if (storedRow) {
        await storage.updateTimeOffBalance(storedRow.id, {
          totalHours: computedTotal,
          usedHours: computedUsed,
        });
      } else {
        await db.insert(timeOffBalances).values({
          userId,
          type,
          totalHours: computedTotal,
          usedHours: computedUsed,
          year,
        });
      }
      rowsWritten++;
      buckets.push({
        type,
        storedTotal,
        storedUsed,
        computedTotal,
        computedUsed,
        totalDelta: computedTotal - (storedTotal ?? 0),
        usedDelta: computedUsed - (storedUsed ?? 0),
      });
    }

    if (buckets.length > 0) appliedUsers.push({ userId, buckets });
  }

  if (appliedUsers.length > 0) {
    await writeAuditLog({
      actorUserId,
      targetType: "reconciliation",
      targetId: "pto",
      action: "reconciliation.pto.applied",
      newValue: { year, userCount: appliedUsers.length, rowsWritten, changes: appliedUsers },
      ...ctx,
    });
  }

  return { applied: appliedUsers.length, rowsWritten };
}

// ---------------------------------------------------------------------------
// 3. Payroll export verification (read-only)
// ---------------------------------------------------------------------------

export interface PayrollDiscrepancy {
  employeeId: string;
  employeeName: string;
  workDate: string;
  punchLogId: string | null;
  issue: string;
  storedRegular: number;
  storedOvertime: number;
  storedDoubleTime: number;
  computedRegular: number | null;
  computedOvertime: number | null;
  computedDoubleTime: number | null;
}

export interface PayrollVerificationResult {
  exportId: string;
  startDate: string;
  endDate: string;
  status: string;
  recordsChecked: number;
  discrepancyCount: number;
  discrepancies: PayrollDiscrepancy[];
}

export async function computePayrollVerification(exportId: string): Promise<PayrollVerificationResult | null> {
  const exp = await storage.getPayrollExport(exportId);
  if (!exp) return null;

  const records = await storage.getPayrollBatchRecords(exportId);
  const userMap = new Map((await storage.getAllUsers()).map((u) => [u.id, u]));

  // Batch records are stored per employee-day (only the primary punch is
  // linked), so recompute each day's hours by SUMMING all source punches for
  // that employee on that date, then split with the SAME policy that was frozen
  // onto the row. `null` marks a day with an incomplete/in-progress punch.
  const punches = await storage.getAttendanceByDateRange(exp.startDate, exp.endDate);
  const dayHours = new Map<string, number | null>();
  const dayKey = (employeeId: string, workDate: string) => `${employeeId}__${workDate}`;
  for (const p of punches) {
    const key = dayKey(p.employeeId, p.workDate);
    const existing = dayHours.get(key);
    if (existing === null) continue; // already flagged incomplete
    const h = computePunchHoursWorked(p);
    if (h === null) {
      dayHours.set(key, null);
      continue;
    }
    dayHours.set(key, round2((existing ?? 0) + h));
  }

  // Holiday detection (current schedules) + per-employee resolved policy used as
  // the fallback for legacy rows that predate the snapshot columns.
  const scheduleCache = new Map<string, number[]>();
  const scheduledDaysFor = async (employeeId: string): Promise<number[]> => {
    if (!scheduleCache.has(employeeId)) {
      const schedules = await storage.getEmployeeSchedules(employeeId);
      scheduleCache.set(employeeId, schedules.filter((s) => s.isActive).map((s) => s.dayOfWeek));
    }
    return scheduleCache.get(employeeId)!;
  };
  const resolvedPolicyCache = new Map<string, PayCalcPolicy>();
  const resolvedPolicyFor = async (employeeId: string): Promise<PayCalcPolicy> => {
    if (!resolvedPolicyCache.has(employeeId)) {
      const u = userMap.get(employeeId);
      const [att, pay, pto] = u
        ? await Promise.all([
            getEffectivePolicy(u.companyId, employeeId, "attendance", u),
            getEffectivePolicy(u.companyId, employeeId, "payroll", u),
            getEffectivePolicy(u.companyId, employeeId, "pto", u),
          ])
        : [null, null, null];
      resolvedPolicyCache.set(
        employeeId,
        buildPayCalcPolicy(att?.rules, pay?.rules, pto?.rules, {
          attendance: att?.version ?? null,
          payroll: pay?.version ?? null,
        }),
      );
    }
    return resolvedPolicyCache.get(employeeId)!;
  };

  const getDayOfWeek = (dateStr: string): number => {
    const parts = dateStr.split("-");
    return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))).getUTCDay();
  };

  const discrepancies: PayrollDiscrepancy[] = [];
  let recordsChecked = 0;

  // Only attendance-derived rows are recomputable from punch logs; PTO and
  // cash-out rows are snapshots of approved requests and are out of scope.
  const attendanceRecords = records.filter((r) => r.recordType === "attendance");

  // Recompute the WEEKLY-aware split per employee. Records are grouped by
  // employee so weekly overtime is reconciled across the same workweek it was
  // exported on: daily OT/DT first, then regular hours over the frozen weekly
  // threshold reclassified to OT. The result is keyed per employee-day and
  // looked up in the per-record reporting loop below.
  const recordsByEmployee = new Map<string, typeof attendanceRecords>();
  for (const r of attendanceRecords) {
    const arr = recordsByEmployee.get(r.employeeId);
    if (arr) arr.push(r);
    else recordsByEmployee.set(r.employeeId, [r]);
  }
  const splitByKey = new Map<string, { regularHours: number; overtimeHours: number; doubleTimeHours: number }>();

  for (const [employeeId, empRecords] of recordsByEmployee) {
    const resolved = await resolvedPolicyFor(employeeId);
    // Prefer the policy SNAPSHOT frozen on the rows so a CLOSED historical period
    // verifies against EXACTLY what was exported, independent of any later edit
    // to the live policy or the employee's schedule. A row is "snapshotted" when
    // the numeric knobs are present; for those rows every input to the split —
    // thresholds, multipliers, the on/off toggles AND the holiday flag — comes
    // from the row. Snapshot rows that PREDATE weekly OT (weekly cols all null)
    // recompute weekly-DISABLED so their historical dollars never shift. Only
    // fully-legacy rows (no snapshot at all) fall back to the live policy.
    const sample = empRecords.find((r) => r.otThresholdDaily != null || r.overtimeMultiplier != null);
    const hasWeeklySnapshot = empRecords.some(
      (r) => r.otThresholdWeekly != null || r.weeklyOvertimeEnabled != null || r.workweekStartDay != null,
    );
    let policy: PayCalcPolicy;
    if (sample) {
      policy = {
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
        weeklyOvertimeEnabled: hasWeeklySnapshot ? (sample.weeklyOvertimeEnabled ?? resolved.weeklyOvertimeEnabled) : false,
        workweekStartDay: sample.workweekStartDay ?? resolved.workweekStartDay,
      };
    } else {
      policy = resolved;
    }

    // Only days with COMPLETE source punches participate in the weekly split;
    // missing/incomplete days are reported separately in the loop below.
    const days: Array<{ date: string; hours: number; isHoliday: boolean }> = [];
    for (const r of empRecords) {
      const hours = dayHours.get(dayKey(r.employeeId, r.workDate));
      if (hours == null) continue;
      let isHoliday: boolean;
      if (sample && r.isHoliday != null) {
        isHoliday = r.isHoliday;
      } else {
        const scheduledDays = await scheduledDaysFor(r.employeeId);
        isHoliday = scheduledDays.length > 0 && !scheduledDays.includes(getDayOfWeek(r.workDate));
      }
      days.push({ date: r.workDate, hours, isHoliday });
    }
    const weekly = computeWeeklyHours(days, policy);
    for (const d of weekly.days) {
      splitByKey.set(dayKey(employeeId, d.date), {
        regularHours: d.regularHours,
        overtimeHours: d.overtimeHours,
        doubleTimeHours: d.doubleTimeHours,
      });
    }
  }

  for (const r of attendanceRecords) {
    recordsChecked++;

    const storedRegular = r.regularHours || 0;
    const storedOvertime = r.overtimeHours || 0;
    const storedDoubleTime = r.doubleTimeHours || 0;
    const base = {
      employeeId: r.employeeId,
      employeeName: userName(userMap.get(r.employeeId)),
      workDate: r.workDate,
      punchLogId: r.punchLogId ?? null,
      storedRegular: round2(storedRegular),
      storedOvertime: round2(storedOvertime),
      storedDoubleTime: round2(storedDoubleTime),
    };

    const key = dayKey(r.employeeId, r.workDate);
    if (!dayHours.has(key)) {
      discrepancies.push({
        ...base,
        issue: "No source punches found for this employee-day (deleted after export?).",
        computedRegular: null,
        computedOvertime: null,
        computedDoubleTime: null,
      });
      continue;
    }

    const hours = dayHours.get(key)!;
    if (hours === null) {
      discrepancies.push({
        ...base,
        issue: "Source punch is incomplete/in-progress.",
        computedRegular: null,
        computedOvertime: null,
        computedDoubleTime: null,
      });
      continue;
    }

    const split = splitByKey.get(key);
    if (!split) continue; // defensive: every complete day was split above

    const regDrift = Math.abs(split.regularHours - storedRegular) > HOURS_EPSILON;
    const otDrift = Math.abs(split.overtimeHours - storedOvertime) > HOURS_EPSILON;
    const dtDrift = Math.abs(split.doubleTimeHours - storedDoubleTime) > HOURS_EPSILON;
    if (regDrift || otDrift || dtDrift) {
      discrepancies.push({
        ...base,
        issue: "Exported hours no longer match the engine's recompute of the source punches.",
        computedRegular: split.regularHours,
        computedOvertime: split.overtimeHours,
        computedDoubleTime: split.doubleTimeHours,
      });
    }
  }

  discrepancies.sort(
    (a, b) => a.workDate.localeCompare(b.workDate) || a.employeeName.localeCompare(b.employeeName),
  );

  return {
    exportId,
    startDate: exp.startDate,
    endDate: exp.endDate,
    status: exp.status,
    recordsChecked,
    discrepancyCount: discrepancies.length,
    discrepancies,
  };
}
