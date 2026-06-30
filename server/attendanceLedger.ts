/**
 * THE attendance ledger — the canonical, persisted, per-employee-per-day record
 * of computed attendance results (regular / overtime / double-time / total
 * worked hours + the day's PTO impact + holiday determination).
 *
 * It is a thin MATERIALIZATION of the pay engine: every row is produced by
 * `payrollEngine.computeWeeklyHours` (which splits each day with the daily rule
 * first, then reclassifies regular hours over the weekly threshold into overtime
 * across the workweek) against the CURRENT effective policy, fed the SAME
 * canonical break-deducted worked-hours input every other surface uses
 * (persisted `punch_logs.hours_worked`, with a live fallback for still-open
 * punches). No attendance/OT math lives here that isn't the engine's — so the
 * ledger is the single source of truth even for weekly overtime.
 *
 * Read path = recompute-through: the read helpers recompute each requested
 * employee-day in memory (deterministic, so every consumer agrees) and
 * write-through to the table with a diff-upsert (no-op writes skipped, so steady
 * reads are pure reads). The persisted rows are the durable record payroll reads
 * after a recompute and that admins can inspect.
 *
 * Freshness on fact changes is driven by `recomputeLedger(...)`, called from the
 * write paths (clock-out, punch edits, exception resolution, auto-clock-out, PTO
 * approve/deny/adjust). This module intentionally does NOT get imported by
 * `storage.ts` (that would create a circular import) — hooks live at the
 * route/service layer.
 *
 * See docs/attendance-ledger.md for the full data-classification audit + design.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  attendanceLedger,
  type AttendanceLedger,
  type PunchLog,
  type TimeOffRequest,
  type User,
} from "@shared/schema";
import { storage } from "./storage";
import {
  computeWeeklyHours,
  resolvePayCalcPolicy,
  round2,
  type PayCalcPolicy,
} from "./payrollEngine";

/**
 * The in-memory shape of a computed ledger day (before persistence). Mirrors the
 * persisted columns so a diff against the stored row is trivial.
 */
export interface LedgerDay {
  employeeId: string;
  workDate: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
  ptoHours: number;
  isHoliday: boolean;
  hasOpenPunch: boolean;
  status: "complete" | "overtime";
  sourcePunchCount: number;
  attendancePolicyVersion: number | null;
  payrollPolicyVersion: number | null;
}

export interface LedgerTotals {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  /** OT + double-time combined (the single "overtime" figure surfaces use). */
  overtimeCombined: number;
  ptoHours: number;
  daysWorked: number;
}

/**
 * Canonical per-punch worked hours — IDENTICAL to timesheetService.punchWorkedHours
 * and the SQL in storage.getDailyHoursByDateRange: prefer the persisted,
 * break-deducted `hours_worked`; for a still-open punch fall back to a live,
 * break-deducted compute from the rounded clock-in. Keeping this rule in one
 * shape across every surface is what stops break/rounding drift.
 */
function punchWorkedHours(p: PunchLog, now: Date): number {
  if (p.hoursWorked != null) return p.hoursWorked;
  if (!p.clockIn) return 0;
  const start = new Date(p.roundedClockIn ?? p.clockIn).getTime();
  const end = p.clockOut ? new Date(p.roundedClockOut ?? p.clockOut).getTime() : now.getTime();
  if (!(end > start)) return 0;
  const breakMs = (p.breakMinutes || 0) * 60 * 1000;
  return Math.max(0, (end - start - breakMs) / (1000 * 60 * 60));
}

function dayOfWeekUTC(dateStr: string): number {
  const parts = dateStr.split("-");
  return new Date(
    Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)),
  ).getUTCDay();
}

function eachDate(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    out.push(cur.toISOString().split("T")[0]);
  }
  return out;
}

/** Per-employee inputs resolved once and reused across the employee's days. */
interface EmployeeContext {
  payCalc: PayCalcPolicy;
  scheduledDays: number[];
}

async function resolveEmployeeContext(employee: User): Promise<EmployeeContext> {
  const [payCalc, schedules] = await Promise.all([
    resolvePayCalcPolicy(employee),
    storage.getEmployeeSchedules(employee.id),
  ]);
  return {
    payCalc,
    scheduledDays: schedules.filter((s) => s.isActive).map((s) => s.dayOfWeek),
  };
}

/**
 * Approved (non-cashout) time-off hours attributable to a single date, spread
 * evenly across the covered days. Display-only — payroll's PTO line items come
 * from the authoritative time_off_requests, not this figure.
 */
function ptoHoursForDate(dateStr: string, approvedTimeOff: TimeOffRequest[]): number {
  let total = 0;
  for (const r of approvedTimeOff) {
    const effectiveEnd =
      r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate;
    if (!(r.startDate <= dateStr && effectiveEnd >= dateStr)) continue;
    const days = Math.max(1, eachDate(r.startDate, effectiveEnd).length);
    const requestHours = r.hoursApproved ?? r.hoursRequested ?? 8;
    total += requestHours / days;
  }
  return round2(total);
}

/** The raw (pre-split) facts for one employee-date — worked hours + flags. */
interface RawDay {
  workDate: string;
  dayHours: number;
  isHoliday: boolean;
  hasOpenPunch: boolean;
  workedPunchCount: number;
}

/**
 * Collapse a day's punches into raw worked hours + flags (no OT split yet). The
 * split is deferred to a weekly-aware pass so regular hours over the weekly
 * threshold can be reclassified into overtime across the workweek.
 */
function computeRawDay(
  workDate: string,
  dayPunches: PunchLog[],
  ctx: EmployeeContext,
  now: Date,
): RawDay {
  let dayHours = 0;
  let hasOpenPunch = false;
  let workedPunchCount = 0;
  for (const p of dayPunches) {
    if (!p.clockIn) continue;
    workedPunchCount++;
    dayHours += punchWorkedHours(p, now);
    if (p.status === "in-progress" || (!p.clockOut && p.hoursWorked == null)) {
      hasOpenPunch = true;
    }
  }
  return {
    workDate,
    dayHours: round2(dayHours),
    isHoliday: ctx.scheduledDays.length > 0 && !ctx.scheduledDays.includes(dayOfWeekUTC(workDate)),
    hasOpenPunch,
    workedPunchCount,
  };
}

/**
 * Build the persisted ledger days for ONE employee over an ordered list of
 * dates. Worked days are split via the engine's WEEKLY-aware aggregation
 * (`computeWeeklyHours`) over the whole range — daily OT/DT first, then regular
 * hours over the weekly threshold reclassified to OT grouped by workweek — so
 * the ledger is the single source of truth even for weekly overtime. PTO-only
 * days carry a display PTO figure. Days with neither are omitted (no row).
 */
function buildLedgerDays(
  employeeId: string,
  dates: string[],
  punchesByDate: Map<string, PunchLog[]>,
  approvedTimeOff: TimeOffRequest[],
  ctx: EmployeeContext,
  now: Date,
): LedgerDay[] {
  const raws = dates.map((d) => computeRawDay(d, punchesByDate.get(d) || [], ctx, now));

  const workedRaws = raws.filter((r) => r.workedPunchCount > 0 && r.dayHours > 0);
  const weekly = computeWeeklyHours(
    workedRaws.map((r) => ({ date: r.workDate, hours: r.dayHours, isHoliday: r.isHoliday })),
    ctx.payCalc,
  );
  const splitByDate = new Map(weekly.days.map((d) => [d.date, d] as const));

  const out: LedgerDay[] = [];
  for (const raw of raws) {
    if (raw.workedPunchCount > 0 && raw.dayHours > 0) {
      const split = splitByDate.get(raw.workDate);
      if (!split) continue;
      out.push({
        employeeId,
        workDate: raw.workDate,
        regularHours: split.regularHours,
        overtimeHours: split.overtimeHours,
        doubleTimeHours: split.doubleTimeHours,
        totalHours: split.hoursWorked,
        ptoHours: 0,
        isHoliday: raw.isHoliday,
        hasOpenPunch: raw.hasOpenPunch,
        status: split.status,
        sourcePunchCount: raw.workedPunchCount,
        attendancePolicyVersion: ctx.payCalc.attendancePolicyVersion,
        payrollPolicyVersion: ctx.payCalc.payrollPolicyVersion,
      });
      continue;
    }

    const ptoHours = ptoHoursForDate(raw.workDate, approvedTimeOff);
    if (ptoHours > 0) {
      out.push({
        employeeId,
        workDate: raw.workDate,
        regularHours: 0,
        overtimeHours: 0,
        doubleTimeHours: 0,
        totalHours: 0,
        ptoHours,
        isHoliday: raw.isHoliday,
        hasOpenPunch: false,
        status: "complete",
        sourcePunchCount: 0,
        attendancePolicyVersion: ctx.payCalc.attendancePolicyVersion,
        payrollPolicyVersion: ctx.payCalc.payrollPolicyVersion,
      });
    }
  }

  return out;
}

function approvedTimeOffOverlapping(
  requests: TimeOffRequest[],
  startDate: string,
  endDate: string,
): TimeOffRequest[] {
  return requests.filter((r) => {
    if (r.requestCategory === "cashout") return false;
    if (!(r.status === "approved" || r.status === "partially_approved")) return false;
    const effectiveEnd =
      r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate;
    return r.startDate <= endDate && effectiveEnd >= startDate;
  });
}

function ledgerRowsEqual(a: LedgerDay, b: AttendanceLedger): boolean {
  return (
    a.regularHours === b.regularHours &&
    a.overtimeHours === b.overtimeHours &&
    a.doubleTimeHours === b.doubleTimeHours &&
    a.totalHours === b.totalHours &&
    a.ptoHours === b.ptoHours &&
    a.isHoliday === b.isHoliday &&
    a.hasOpenPunch === b.hasOpenPunch &&
    a.status === b.status &&
    a.sourcePunchCount === b.sourcePunchCount &&
    (a.attendancePolicyVersion ?? null) === (b.attendancePolicyVersion ?? null) &&
    (a.payrollPolicyVersion ?? null) === (b.payrollPolicyVersion ?? null)
  );
}

/**
 * Persist a freshly computed set of ledger days for ONE employee over a date
 * range: upsert changed days, delete rows in [startDate, endDate] that no longer
 * have a computed day. No-op writes are skipped so steady-state reads don't churn
 * the table.
 */
async function persistEmployeeRange(
  employeeId: string,
  startDate: string,
  endDate: string,
  computed: LedgerDay[],
): Promise<void> {
  const existing = await db
    .select()
    .from(attendanceLedger)
    .where(
      and(
        eq(attendanceLedger.employeeId, employeeId),
        gte(attendanceLedger.workDate, startDate),
        lte(attendanceLedger.workDate, endDate),
      ),
    );
  const existingByDate = new Map(existing.map((r) => [r.workDate, r] as const));
  const computedByDate = new Map(computed.map((d) => [d.workDate, d] as const));

  const toWrite: LedgerDay[] = [];
  for (const day of computed) {
    const prev = existingByDate.get(day.workDate);
    if (!prev || !ledgerRowsEqual(day, prev)) toWrite.push(day);
  }
  const toDelete: string[] = [];
  for (const r of existing) {
    if (!computedByDate.has(r.workDate)) toDelete.push(r.workDate);
  }

  for (const day of toWrite) {
    await db
      .insert(attendanceLedger)
      .values({ ...day, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [attendanceLedger.employeeId, attendanceLedger.workDate],
        set: {
          regularHours: day.regularHours,
          overtimeHours: day.overtimeHours,
          doubleTimeHours: day.doubleTimeHours,
          totalHours: day.totalHours,
          ptoHours: day.ptoHours,
          isHoliday: day.isHoliday,
          hasOpenPunch: day.hasOpenPunch,
          status: day.status,
          sourcePunchCount: day.sourcePunchCount,
          attendancePolicyVersion: day.attendancePolicyVersion,
          payrollPolicyVersion: day.payrollPolicyVersion,
          computedAt: new Date(),
        },
      });
  }

  if (toDelete.length > 0) {
    await db
      .delete(attendanceLedger)
      .where(
        and(
          eq(attendanceLedger.employeeId, employeeId),
          inArray(attendanceLedger.workDate, toDelete),
        ),
      );
  }
}

/**
 * Compute (and write-through persist) the ledger for ONE employee over a range,
 * returning the per-day entries (sorted by date). This is the single read path
 * for per-employee surfaces (the timesheet, the employee dashboard).
 */
export async function getLedgerForEmployee(
  employee: User,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Promise<LedgerDay[]> {
  const [punches, allTimeOff, ctx] = await Promise.all([
    storage.getAttendanceRecords(employee.id, startDate, endDate),
    storage.getTimeOffRequestsByUser(employee.id),
    resolveEmployeeContext(employee),
  ]);
  const approvedTimeOff = approvedTimeOffOverlapping(allTimeOff, startDate, endDate);

  const punchesByDate = new Map<string, PunchLog[]>();
  for (const p of punches) {
    const arr = punchesByDate.get(p.workDate) || [];
    arr.push(p);
    punchesByDate.set(p.workDate, arr);
  }

  const computed = buildLedgerDays(
    employee.id,
    eachDate(startDate, endDate),
    punchesByDate,
    approvedTimeOff,
    ctx,
    now,
  );

  await persistEmployeeRange(employee.id, startDate, endDate, computed);
  return computed;
}

/**
 * Bulk variant for multi-employee surfaces (reports, dashboards). Returns a map
 * of employeeId -> per-day ledger entries. Fetches punches/time-off in one pass
 * and resolves each employee's policy in parallel.
 */
export async function getLedgerForEmployees(
  employees: User[],
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Promise<Map<string, LedgerDay[]>> {
  const result = new Map<string, LedgerDay[]>();
  if (employees.length === 0) return result;

  const empIds = new Set(employees.map((e) => e.id));
  const [allPunches, allTimeOff] = await Promise.all([
    storage.getAttendanceByDateRange(startDate, endDate),
    storage.getAllTimeOffRequests(),
  ]);

  const punchesByEmp = new Map<string, Map<string, PunchLog[]>>();
  for (const p of allPunches) {
    if (!empIds.has(p.employeeId)) continue;
    let byDate = punchesByEmp.get(p.employeeId);
    if (!byDate) {
      byDate = new Map();
      punchesByEmp.set(p.employeeId, byDate);
    }
    const arr = byDate.get(p.workDate) || [];
    arr.push(p);
    byDate.set(p.workDate, arr);
  }

  const timeOffByEmp = new Map<string, TimeOffRequest[]>();
  for (const r of allTimeOff) {
    if (!empIds.has(r.userId)) continue;
    const arr = timeOffByEmp.get(r.userId) || [];
    arr.push(r);
    timeOffByEmp.set(r.userId, arr);
  }

  const dates = eachDate(startDate, endDate);
  await Promise.all(
    employees.map(async (employee) => {
      const ctx = await resolveEmployeeContext(employee);
      const byDate = punchesByEmp.get(employee.id) || new Map<string, PunchLog[]>();
      const approvedTimeOff = approvedTimeOffOverlapping(
        timeOffByEmp.get(employee.id) || [],
        startDate,
        endDate,
      );
      const computed = buildLedgerDays(
        employee.id,
        dates,
        byDate,
        approvedTimeOff,
        ctx,
        now,
      );
      await persistEmployeeRange(employee.id, startDate, endDate, computed);
      result.set(employee.id, computed);
    }),
  );

  return result;
}

export interface HoursRollup {
  /** Sum of total worked hours over [startDate, endDate]. */
  weekHours: number;
  /** Total worked hours attributable to the single `todayDate`. */
  todayHours: number;
}

/**
 * READ-ONLY per-employee hour rollups straight from the PERSISTED ledger rows —
 * a single grouped SQL aggregation, NO recompute and NO write-through. This is
 * the cheap "sort by hours" path for very large rosters: it lets Team Overview
 * order thousands of filtered employees by today/week hours without doing a full
 * recompute-through ledger pass for every row on each request.
 *
 * Trade-off vs. `getLedgerForEmployees`: these numbers are exactly the durable
 * persisted record (kept fresh by the `recomputeLedger` write-hooks on clock-out,
 * punch edits, exception resolution, auto-clock-out and PTO changes), so they
 * match the canonical ledger EXCEPT for the live-elapsing portion of a currently
 * open punch (frozen at last recompute) and employees never yet materialized
 * (treated as 0). That is acceptable for ORDERING; callers that need exact
 * display numbers still recompute-through the visible page via
 * `getLedgerForEmployees`.
 */
export async function getPersistedHoursRollup(
  employeeIds: string[],
  startDate: string,
  endDate: string,
  todayDate: string,
): Promise<Map<string, HoursRollup>> {
  const result = new Map<string, HoursRollup>();
  if (employeeIds.length === 0) return result;

  // Chunk the IN list to stay well under Postgres' bind-parameter ceiling for
  // multi-thousand-employee scopes.
  const CHUNK = 1000;
  for (let i = 0; i < employeeIds.length; i += CHUNK) {
    const chunk = employeeIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        employeeId: attendanceLedger.employeeId,
        weekHours: sql<number>`coalesce(sum(${attendanceLedger.totalHours}), 0)`,
        todayHours: sql<number>`coalesce(sum(case when ${attendanceLedger.workDate} = ${todayDate} then ${attendanceLedger.totalHours} else 0 end), 0)`,
      })
      .from(attendanceLedger)
      .where(
        and(
          inArray(attendanceLedger.employeeId, chunk),
          gte(attendanceLedger.workDate, startDate),
          lte(attendanceLedger.workDate, endDate),
        ),
      )
      .groupBy(attendanceLedger.employeeId);
    for (const r of rows) {
      result.set(r.employeeId, {
        weekHours: round2(Number(r.weekHours)),
        todayHours: round2(Number(r.todayHours)),
      });
    }
  }

  return result;
}

/** Sum a set of ledger days into range totals. */
export function summarizeLedger(days: LedgerDay[]): LedgerTotals {
  let totalHours = 0;
  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  let ptoHours = 0;
  let daysWorked = 0;
  for (const d of days) {
    totalHours += d.totalHours;
    regularHours += d.regularHours;
    overtimeHours += d.overtimeHours;
    doubleTimeHours += d.doubleTimeHours;
    ptoHours += d.ptoHours;
    if (d.totalHours > 0) daysWorked++;
  }
  return {
    totalHours: round2(totalHours),
    regularHours: round2(regularHours),
    overtimeHours: round2(overtimeHours),
    doubleTimeHours: round2(doubleTimeHours),
    overtimeCombined: round2(overtimeHours + doubleTimeHours),
    ptoHours: round2(ptoHours),
    daysWorked,
  };
}

/**
 * Recompute hook for the write paths. Given an employee and a set of affected
 * dates, recompute just those days and upsert/delete the ledger rows. Cheap and
 * best-effort: never throws into the caller's transaction path (a stale ledger
 * row self-heals on the next read, which recomputes through).
 */
export async function recomputeLedger(employeeId: string, dates: string[]): Promise<void> {
  const unique = Array.from(new Set(dates.filter(Boolean)));
  if (unique.length === 0) return;
  try {
    const employee = await storage.getUser(employeeId);
    if (!employee) return;
    unique.sort();
    const startDate = unique[0];
    const endDate = unique[unique.length - 1];
    // Reuse the per-employee read path (compute + diff-persist) over the spanning
    // window; only the affected days change so unaffected rows are left as-is.
    await getLedgerForEmployee(employee, startDate, endDate);
  } catch (err) {
    console.error(`[attendanceLedger] recompute failed for ${employeeId}`, err);
  }
}

/** Convenience: recompute a single employee-day (the common write-hook case). */
export async function recomputeLedgerDay(employeeId: string, workDate: string): Promise<void> {
  return recomputeLedger(employeeId, [workDate]);
}
