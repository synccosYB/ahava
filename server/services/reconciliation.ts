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
import { getEffectivePolicy, DEFAULT_PAYROLL_RULES } from "../policyEngine";
import { buildPayCalcPolicy, splitDailyHours, computeWeeklyHours, resolvePayCalcPolicy, DEFAULT_PAY_CALC_POLICY, type PayCalcPolicy } from "../payrollEngine";
import { evaluateDayOfWeekBonuses, evaluateEarlyArrivalBonuses } from "./policyEnforcement";
import { resolveEmployeeTimezone } from "./punchOverlap";
import { writeAuditLog } from "./audit";
import { writeLedgerEntry } from "./ledger";
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
  timezone: string;
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

  const tzCache = new Map<string, string>();
  const timezoneFor = async (employeeId: string): Promise<string> => {
    if (tzCache.has(employeeId)) return tzCache.get(employeeId)!;
    const tz = await resolveEmployeeTimezone(employeeId);
    tzCache.set(employeeId, tz);
    return tz;
  };

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
      timezone: await timezoneFor(p.employeeId),
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
      timezone: await resolveEmployeeTimezone(p.employeeId),
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

    await Promise.all(
      changes.map((c) =>
        writeLedgerEntry({
          category: "hours",
          eventType: "ot_recalculated",
          employeeId: c.employeeId,
          actorUserId,
          entityType: "punch_log",
          entityId: c.punchLogId,
          workDate: c.workDate,
          hoursDelta: c.hoursDelta,
          beforeValue: { hoursWorked: c.storedHours, status: c.storedStatus },
          afterValue: { hoursWorked: c.computedHours, status: c.computedStatus },
          context: { reconciliation: true },
          source: "system",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        }),
      ),
    );
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

// ---------------------------------------------------------------------------
// 4. Payroll export DRIFT detection (read-only)
// ---------------------------------------------------------------------------
//
// "Drift" = the exported batch no longer matches the CURRENT source data
// (punches, exception approvals, manual edits, late PTO changes). This compares
// the FROZEN snapshot on each `payroll_batch_records` row against a fresh
// recompute of the same source — across hours (regular / overtime / double-time),
// PTO, and bonuses — and reports the per-record differences so an admin can
// decide whether to reopen + re-export or lock the period anyway.
//
// CRITICAL: this is strictly READ-ONLY w.r.t. `payroll_batch_records`. It NEVER
// overwrites, "fixes", or re-syncs a snapshot value — the snapshot is the
// historical record of what was paid. (Distinct from `applyAttendanceReconciliation`
// above, which deliberately rewrites `punch_logs`.)
//
// Hours are recomputed against the FROZEN policy snapshot on the row (only legacy
// rows that predate the snapshot columns fall back to the live policy + current
// schedule), so a later POLICY edit does NOT register as drift — only changes to
// the SOURCE data do. Bonuses aren't snapshotted, so they are recomputed from the
// (re-summed) day hours using the current payroll rules.

export type PayrollDriftField =
  | "regularHours"
  | "overtimeHours"
  | "doubleTimeHours"
  | "ptoHours"
  | "bonusHours"
  | "bonusAmount";

export interface PayrollDriftFieldChange {
  field: PayrollDriftField;
  label: string;
  snapshot: number;
  current: number | null;
}

export interface PayrollDriftValues {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  ptoHours: number;
  bonusHours: number;
  bonusAmount: number;
}

export interface PayrollDriftRecord {
  recordId: string;
  employeeId: string;
  employeeName: string;
  recordType: string;
  workDate: string;
  punchLogId: string | null;
  timeOffRequestId: string | null;
  issue: string | null;
  snapshot: PayrollDriftValues;
  current: PayrollDriftValues | null;
  changes: PayrollDriftFieldChange[];
}

export interface PayrollDriftResult {
  exportId: string;
  startDate: string;
  endDate: string;
  status: string;
  driftStatus: "matches" | "changed";
  recordsChecked: number;
  changedCount: number;
  changedRecords: PayrollDriftRecord[];
}

const DRIFT_FIELD_LABELS: Record<PayrollDriftField, string> = {
  regularHours: "Regular Hours",
  overtimeHours: "Overtime Hours",
  doubleTimeHours: "Double-Time Hours",
  ptoHours: "PTO Hours",
  bonusHours: "Bonus Hours",
  bonusAmount: "Bonus $",
};

const CENTS_EPSILON = 0.005;

function fieldEpsilon(field: PayrollDriftField): number {
  return field === "bonusAmount" ? CENTS_EPSILON : HOURS_EPSILON;
}

export function diffDriftValues(
  snapshot: PayrollDriftValues,
  current: PayrollDriftValues | null,
): PayrollDriftFieldChange[] {
  const fields: PayrollDriftField[] = [
    "regularHours",
    "overtimeHours",
    "doubleTimeHours",
    "ptoHours",
    "bonusHours",
    "bonusAmount",
  ];
  const changes: PayrollDriftFieldChange[] = [];
  for (const field of fields) {
    const snap = snapshot[field];
    const curr = current ? current[field] : null;
    // A missing/uncomputable source (current === null) is itself drift for any
    // non-zero snapshot value.
    if (curr === null) {
      if (Math.abs(snap) > fieldEpsilon(field)) {
        changes.push({ field, label: DRIFT_FIELD_LABELS[field], snapshot: round2(snap), current: null });
      }
      continue;
    }
    if (Math.abs(snap - curr) > fieldEpsilon(field)) {
      changes.push({ field, label: DRIFT_FIELD_LABELS[field], snapshot: round2(snap), current: round2(curr) });
    }
  }
  return changes;
}

export async function computePayrollDrift(exportId: string): Promise<PayrollDriftResult | null> {
  const exp = await storage.getPayrollExport(exportId);
  if (!exp) return null;

  const records = await storage.getPayrollBatchRecords(exportId);
  const userMap = new Map((await storage.getAllUsers()).map((u) => [u.id, u]));

  // Re-sum punches per employee-day (snapshots are stored per employee-day with
  // only the primary punch linked), and track the earliest rounded clock-in for
  // early-arrival bonus recompute. `null` hours marks an incomplete day.
  const punches = await storage.getAttendanceByDateRange(exp.startDate, exp.endDate);
  const dayKey = (employeeId: string, workDate: string) => `${employeeId}__${workDate}`;
  const dayHours = new Map<string, number | null>();
  const dayEarliestRounded = new Map<string, { at: number; rounded: Date | string | null }>();
  for (const p of punches) {
    const key = dayKey(p.employeeId, p.workDate);
    const existing = dayHours.get(key);
    if (existing !== null) {
      const h = computePunchHoursWorked(p);
      if (h === null) {
        dayHours.set(key, null);
      } else {
        dayHours.set(key, round2((existing ?? 0) + h));
      }
    }
    if (p.clockIn) {
      const t = new Date(p.clockIn).getTime();
      const prior = dayEarliestRounded.get(key);
      if (!prior || t < prior.at) {
        dayEarliestRounded.set(key, { at: t, rounded: p.roundedClockIn ?? p.clockIn });
      }
    }
  }

  // Holiday detection (current schedules) + per-employee resolved live policy &
  // payroll rules. The resolved policy is the fallback for legacy rows; payroll
  // rules drive the (non-snapshotted) bonus recompute.
  const scheduleCache = new Map<string, number[]>();
  const scheduledDaysFor = async (employeeId: string): Promise<number[]> => {
    if (!scheduleCache.has(employeeId)) {
      const schedules = await storage.getEmployeeSchedules(employeeId);
      scheduleCache.set(employeeId, schedules.filter((s) => s.isActive).map((s) => s.dayOfWeek));
    }
    return scheduleCache.get(employeeId)!;
  };
  const resolvedCache = new Map<string, { policy: PayCalcPolicy; payrollRules: Record<string, any> }>();
  const resolvedFor = async (employeeId: string) => {
    if (!resolvedCache.has(employeeId)) {
      const u = userMap.get(employeeId);
      const [att, pay, pto] = u
        ? await Promise.all([
            getEffectivePolicy(u.companyId, employeeId, "attendance", u),
            getEffectivePolicy(u.companyId, employeeId, "payroll", u),
            getEffectivePolicy(u.companyId, employeeId, "pto", u),
          ])
        : [null, null, null];
      resolvedCache.set(employeeId, {
        policy: buildPayCalcPolicy(att?.rules, pay?.rules, pto?.rules, {
          attendance: att?.version ?? null,
          payroll: pay?.version ?? null,
        }),
        payrollRules: (pay?.rules as Record<string, any>) || DEFAULT_PAYROLL_RULES,
      });
    }
    return resolvedCache.get(employeeId)!;
  };
  const getDayOfWeek = (dateStr: string): number => {
    const parts = dateStr.split("-");
    return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))).getUTCDay();
  };

  const changedRecords: PayrollDriftRecord[] = [];
  let recordsChecked = 0;

  for (const r of records) {
    recordsChecked++;
    const snapshot: PayrollDriftValues = {
      regularHours: round2(r.regularHours || 0),
      overtimeHours: round2(r.overtimeHours || 0),
      doubleTimeHours: round2(r.doubleTimeHours || 0),
      ptoHours: round2(r.ptoHours || 0),
      bonusHours: round2(r.bonusHours || 0),
      bonusAmount: round2(r.bonusAmount || 0),
    };

    let current: PayrollDriftValues | null = null;
    let issue: string | null = null;

    if (r.recordType === "attendance") {
      const key = dayKey(r.employeeId, r.workDate);
      if (!dayHours.has(key)) {
        issue = "No source punches found for this employee-day (deleted after export?).";
      } else {
        const hours = dayHours.get(key)!;
        if (hours === null) {
          issue = "Source punch is incomplete/in-progress.";
        } else {
          // Prefer the FROZEN policy snapshot so only source-data changes drift,
          // not later policy edits. Legacy rows fall back to the live policy.
          const isSnapshotted = r.otThresholdDaily != null || r.overtimeMultiplier != null;
          let policy: PayCalcPolicy;
          let isHoliday: boolean;
          if (isSnapshotted) {
            const resolved = (await resolvedFor(r.employeeId)).policy;
            policy = {
              ...resolved,
              otThresholdDaily: r.otThresholdDaily ?? resolved.otThresholdDaily,
              doubleTimeThresholdDaily: r.doubleTimeThresholdDaily ?? resolved.doubleTimeThresholdDaily,
              overtimeMultiplier: r.overtimeMultiplier ?? resolved.overtimeMultiplier,
              doubleTimeMultiplier: r.doubleTimeMultiplier ?? resolved.doubleTimeMultiplier,
              autoCalculateOT: r.autoCalculateOt ?? resolved.autoCalculateOT,
              overtimeEnabled: r.overtimeEnabled ?? resolved.overtimeEnabled,
              doubleTimeEnabled: r.doubleTimeEnabled ?? resolved.doubleTimeEnabled,
              holidayOtExclusion: r.holidayOtExclusion ?? resolved.holidayOtExclusion,
            };
            if (r.isHoliday != null) {
              isHoliday = r.isHoliday;
            } else {
              const sd = await scheduledDaysFor(r.employeeId);
              isHoliday = sd.length > 0 && !sd.includes(getDayOfWeek(r.workDate));
            }
          } else {
            policy = (await resolvedFor(r.employeeId)).policy;
            const sd = await scheduledDaysFor(r.employeeId);
            isHoliday = sd.length > 0 && !sd.includes(getDayOfWeek(r.workDate));
          }
          const split = splitDailyHours(hours, policy, { isHoliday });

          // Bonuses are not snapshotted — recompute from the re-summed day hours
          // using the current payroll rules.
          const payrollRules = (await resolvedFor(r.employeeId)).payrollRules;
          const earliestRounded = dayEarliestRounded.get(key)?.rounded ?? null;
          const dow = evaluateDayOfWeekBonuses(r.workDate, hours, payrollRules);
          const early = evaluateEarlyArrivalBonuses(r.workDate, earliestRounded, hours, payrollRules);

          current = {
            regularHours: round2(split.regularHours),
            overtimeHours: round2(split.overtimeHours),
            doubleTimeHours: round2(split.doubleTimeHours),
            ptoHours: 0,
            bonusHours: round2(dow.bonusHours),
            bonusAmount: round2(dow.bonusAmount + early.bonusAmount),
          };
        }
      }
    } else if (r.recordType === "pto" || r.recordType === "pto_cashout") {
      const reqId = r.timeOffRequestId;
      const tor = reqId ? await storage.getTimeOffRequest(reqId) : undefined;
      if (!tor) {
        issue = "Source time-off request not found (deleted after export?).";
      } else {
        const isCashout = r.recordType === "pto_cashout";
        const categoryMatches = isCashout
          ? tor.requestCategory === "cashout"
          : tor.requestCategory !== "cashout";
        const stillApproved = tor.status === "approved" && categoryMatches;
        const currentPto = stillApproved ? round2(tor.hoursRequested || 8) : 0;
        if (!stillApproved) {
          issue = `Time-off request is no longer approved (status: ${tor.status}).`;
        }
        current = {
          regularHours: 0,
          overtimeHours: 0,
          doubleTimeHours: 0,
          ptoHours: currentPto,
          bonusHours: 0,
          bonusAmount: 0,
        };
      }
    } else {
      // Unknown record type — leave current null (cannot recompute) but only
      // flag it if the snapshot carried non-zero values.
      issue = `Unrecognized record type "${r.recordType}".`;
    }

    const changes = diffDriftValues(snapshot, current);
    const hasIssueDrift = current === null && issue !== null &&
      (snapshot.regularHours !== 0 || snapshot.overtimeHours !== 0 ||
       snapshot.doubleTimeHours !== 0 || snapshot.ptoHours !== 0 ||
       snapshot.bonusHours !== 0 || snapshot.bonusAmount !== 0 || changes.length > 0);

    if (changes.length > 0 || hasIssueDrift) {
      changedRecords.push({
        recordId: r.id,
        employeeId: r.employeeId,
        employeeName: userName(userMap.get(r.employeeId)),
        recordType: r.recordType,
        workDate: r.workDate,
        punchLogId: r.punchLogId ?? null,
        timeOffRequestId: r.timeOffRequestId ?? null,
        issue,
        snapshot,
        current,
        changes,
      });
    }
  }

  changedRecords.sort(
    (a, b) => a.workDate.localeCompare(b.workDate) || a.employeeName.localeCompare(b.employeeName),
  );

  return {
    exportId,
    startDate: exp.startDate,
    endDate: exp.endDate,
    status: exp.status,
    driftStatus: changedRecords.length > 0 ? "changed" : "matches",
    recordsChecked,
    changedCount: changedRecords.length,
    changedRecords,
  };
}
