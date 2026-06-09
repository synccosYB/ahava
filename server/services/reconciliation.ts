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
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES } from "../policyEngine";
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

async function buildOtThresholdResolver() {
  const cache = new Map<string, number>();
  const userMap = new Map((await storage.getAllUsers()).map((u) => [u.id, u]));
  return {
    userMap,
    async otThresholdFor(employeeId: string): Promise<number> {
      if (cache.has(employeeId)) return cache.get(employeeId)!;
      const u = userMap.get(employeeId);
      let threshold = DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
      if (u) {
        const policy = await getEffectivePolicy(u.companyId, employeeId, "attendance", u);
        const rules = (policy?.rules as { otThresholdDaily?: number } | undefined) || DEFAULT_ATTENDANCE_RULES;
        threshold = rules.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
      }
      cache.set(employeeId, threshold);
      return threshold;
    },
  };
}

export async function computeAttendanceReconciliation(
  startDate: string,
  endDate: string,
): Promise<AttendanceReconciliationResult> {
  const punches = await storage.getAttendanceByDateRange(startDate, endDate);
  const { userMap, otThresholdFor } = await buildOtThresholdResolver();

  const items: AttendanceDiffItem[] = [];
  let scanned = 0;

  for (const p of punches) {
    // Only finished punches yield a derived hours value. Leave in-progress /
    // malformed punches untouched.
    const computed = computePunchHoursWorked(p);
    if (computed === null) continue;
    scanned++;

    const stored = p.hoursWorked ?? 0;
    const threshold = await otThresholdFor(p.employeeId);
    const computedStatus = computed > threshold ? "overtime" : "complete";
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
  const { userMap, otThresholdFor } = await buildOtThresholdResolver();
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
    const threshold = await otThresholdFor(p.employeeId);
    const computedStatus = computed > threshold ? "overtime" : "complete";
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
  computedRegular: number | null;
  computedOvertime: number | null;
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
  const { userMap, otThresholdFor } = await buildOtThresholdResolver();

  const discrepancies: PayrollDiscrepancy[] = [];
  let recordsChecked = 0;

  for (const r of records) {
    // Only attendance-derived rows are recomputable from punch logs; PTO and
    // cash-out rows are snapshots of approved requests and are out of scope.
    if (r.recordType !== "attendance") continue;
    recordsChecked++;

    const storedRegular = r.regularHours || 0;
    const storedOvertime = r.overtimeHours || 0;
    const base = {
      employeeId: r.employeeId,
      employeeName: userName(userMap.get(r.employeeId)),
      workDate: r.workDate,
      punchLogId: r.punchLogId ?? null,
      storedRegular: round2(storedRegular),
      storedOvertime: round2(storedOvertime),
    };

    if (!r.punchLogId) {
      discrepancies.push({
        ...base,
        issue: "Batch record has no linked punch (cannot verify against source).",
        computedRegular: null,
        computedOvertime: null,
      });
      continue;
    }

    const punch = await storage.getPunchLog(r.punchLogId);
    if (!punch) {
      discrepancies.push({
        ...base,
        issue: "Source punch was deleted after export.",
        computedRegular: null,
        computedOvertime: null,
      });
      continue;
    }

    const hours = computePunchHoursWorked(punch);
    if (hours === null) {
      discrepancies.push({
        ...base,
        issue: "Source punch is incomplete/in-progress.",
        computedRegular: null,
        computedOvertime: null,
      });
      continue;
    }

    const threshold = await otThresholdFor(r.employeeId);
    let computedRegular = hours;
    let computedOvertime = 0;
    if (hours > threshold) {
      computedRegular = threshold;
      computedOvertime = round2(hours - threshold);
    }
    computedRegular = round2(computedRegular);

    const regDrift = Math.abs(computedRegular - storedRegular) > HOURS_EPSILON;
    const otDrift = Math.abs(computedOvertime - storedOvertime) > HOURS_EPSILON;
    if (regDrift || otDrift) {
      discrepancies.push({
        ...base,
        issue: "Exported hours no longer match the engine's recompute of the source punch.",
        computedRegular,
        computedOvertime,
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
