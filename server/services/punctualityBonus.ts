/**
 * Weekly Punctuality Rate Bonus.
 *
 * When enabled on an employee's payroll policy, an employee who clocks in
 * on-time — within the attendance grace period — on EVERY scheduled day of a
 * pay week earns an elevated hourly rate for that whole week. The elevated rate
 * is `base + bonusPerHour`, and the *differential* (`bonusPerHour` per hour) is
 * applied to regular, overtime AND double-time hours, with the OT/DT portions
 * scaled by their pay multipliers. Concretely, the extra pay for a granted week
 * is:
 *
 *   regularHours * delta
 *     + overtimeHours   * delta * overtimeMultiplier
 *     + doubleTimeHours * delta * doubleTimeMultiplier
 *
 * Per-week status (stored in `punctuality_bonus_weeks`, keyed by employee +
 * workweek-start):
 *   - qualified       : on-time every scheduled day        → auto-granted.
 *   - forfeited_late  : late (past grace) on ≥1 sched. day  → auto-forfeited.
 *   - pending_review  : never late, but missed a scheduled  → manager review.
 *                       day with no approved PTO covering it
 *   - granted         : a manager approved a pending week   → paid.
 *   - denied          : a manager denied a pending week     → not paid.
 *
 * `forfeited_late` takes precedence over an absence — a late arrival is an
 * automatic forfeit and never needs a manager. Approved PTO on a scheduled day
 * is EXCUSED (neither triggers review nor forfeits).
 *
 * The math here NEVER touches base-pay computation. It only produces the
 * additive differential that the payroll batch surfaces through the existing
 * `bonusAmount` column, exactly like the day-of-week / early-arrival bonuses.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  punctualityBonusWeeks,
  type EmployeeSchedule,
  type PunchLog,
  type TimeOffRequest,
  type PunctualityBonusStatus,
  type PunctualityBonusWeek,
} from "@shared/schema";
import { DEFAULT_PAYROLL_RULES } from "../policyEngine";
import { round2, workweekStartFor, type WeeklyHoursResult } from "../payrollEngine";
import { localTimeParts } from "../scheduleWarning";

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export interface PunctualityBonusConfig {
  enabled: boolean;
  bonusPerHour: number;
  label: string;
}

/**
 * Resolve the punctuality-bonus config from a payroll rules object, falling back
 * to DEFAULT_PAYROLL_RULES. `enabled` is only true when explicitly enabled AND
 * the per-hour delta is a positive finite number.
 */
export function resolvePunctualityBonusConfig(
  payrollRules: Record<string, any> | null | undefined,
): PunctualityBonusConfig {
  const raw = (payrollRules && (payrollRules as any).punctualityBonus) || DEFAULT_PAYROLL_RULES.punctualityBonus;
  const bonusPerHour = Number(raw?.bonusPerHour);
  const validPerHour = Number.isFinite(bonusPerHour) && bonusPerHour > 0 ? bonusPerHour : 0;
  const label = typeof raw?.label === "string" && raw.label.trim() ? raw.label.trim() : "Weekly Punctuality Bonus";
  return {
    enabled: raw?.enabled === true && validPerHour > 0,
    bonusPerHour: validPerHour,
    label,
  };
}

/**
 * The spec differential for one granted week. Pure. The OT/DT differentials are
 * scaled by their pay multipliers so a $2/hr delta on OT@1.5x adds $3/hr on OT
 * hours, matching the elevated base rate flowing through the same multipliers.
 */
export function computePunctualityDifferential(
  hours: { regularHours: number; overtimeHours: number; doubleTimeHours: number },
  bonusPerHour: number,
  overtimeMultiplier: number,
  doubleTimeMultiplier: number,
): number {
  const delta = Number(bonusPerHour) || 0;
  if (delta <= 0) return 0;
  const reg = Math.max(0, hours.regularHours || 0);
  const ot = Math.max(0, hours.overtimeHours || 0);
  const dt = Math.max(0, hours.doubleTimeHours || 0);
  return round2(
    reg * delta +
      ot * delta * (Number(overtimeMultiplier) || 0) +
      dt * delta * (Number(doubleTimeMultiplier) || 0),
  );
}

/** Statuses that actually pay the differential. */
export function isPayablePunctualityStatus(status: PunctualityBonusStatus): boolean {
  return status === "qualified" || status === "granted";
}

const DATE_MS = 24 * 60 * 60 * 1000;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DATE_MS);
  return dt.toISOString().split("T")[0];
}

function scheduleStartMinutes(startTime: string): number | null {
  const [h, m] = String(startTime || "").split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export interface WeekEvaluationInput {
  weekStartDate: string;
  workweekStartDay: number;
  /** Bound the evaluated scheduled days to the payroll period actually processed. */
  rangeStart: string;
  rangeEnd: string;
  graceMinutes: number;
  timezone: string;
  /** Active schedules for the employee (dayOfWeek + startTime). */
  schedules: EmployeeSchedule[];
  /** All of the employee's punches (any date). */
  punches: PunchLog[];
  /** Approved, non-cashout time-off requests for the employee. */
  approvedTimeOff: TimeOffRequest[];
}

export interface WeekEvaluation {
  /** The auto-determined status BEFORE any manager decision. Null when the week
   *  has no scheduled days in range (nothing to evaluate). */
  autoStatus: "qualified" | "forfeited_late" | "pending_review" | null;
  reason: string | null;
  /** Scheduled in-range dates considered (for diagnostics/tests). */
  scheduledDates: string[];
}

/**
 * Determine the auto status for one pay week from stored source data. Pure w.r.t.
 * the DB (all inputs are passed in). "On-time" compares the earliest clock-in of
 * the day — rendered in the employee's business timezone (same contract as the
 * clock-in schedule warning) — against the scheduled start plus grace.
 */
export function evaluatePunctualityWeek(input: WeekEvaluationInput): WeekEvaluation {
  const {
    weekStartDate,
    workweekStartDay,
    rangeStart,
    rangeEnd,
    graceMinutes,
    timezone,
    schedules,
    punches,
    approvedTimeOff,
  } = input;

  // Earliest clock-in per work-date (prefer the rounded time, matching the
  // app's clock-in lateness detection in enforceClockIn).
  const earliestByDate = new Map<string, Date>();
  for (const p of punches) {
    const raw = p.roundedClockIn ?? p.clockIn;
    if (!raw) continue;
    const t = new Date(raw);
    if (isNaN(t.getTime())) continue;
    const existing = earliestByDate.get(p.workDate);
    if (!existing || t < existing) earliestByDate.set(p.workDate, t);
  }

  const ptoCovers = (dateStr: string): boolean =>
    approvedTimeOff.some(
      (r) =>
        r.status === "approved" &&
        r.requestCategory !== "cashout" &&
        r.startDate <= dateStr &&
        (r.approvedEndDate ?? r.endDate) >= dateStr,
    );

  const activeSchedules = schedules.filter((s) => s.isActive);
  const scheduledDates: string[] = [];
  let lateReason: string | null = null;
  let absentReason: string | null = null;

  const norm = (((workweekStartDay % 7) + 7) % 7);
  for (const s of activeSchedules) {
    const offset = (((s.dayOfWeek % 7) + 7) % 7 - norm + 7) % 7;
    const date = addDays(weekStartDate, offset);
    // Only consider scheduled days that fall inside the processed pay period.
    if (date < rangeStart || date > rangeEnd) continue;
    scheduledDates.push(date);

    const startMin = scheduleStartMinutes(s.startTime);
    const firstIn = earliestByDate.get(date);

    if (firstIn) {
      if (startMin !== null) {
        const inMin = localTimeParts(firstIn, timezone).minutes;
        if (inMin > startMin + graceMinutes) {
          if (!lateReason) {
            lateReason = `Late on ${date}: clocked in ${inMin - startMin} min after ${s.startTime} start (grace ${graceMinutes} min).`;
          }
        }
      }
      // Present + on-time (or no parseable start): does not trigger anything.
      continue;
    }

    // No punch that day — excused only when approved PTO covers it.
    if (!ptoCovers(date)) {
      if (!absentReason) {
        absentReason = `Absent on ${date}: no punch and no approved PTO on a scheduled day.`;
      }
    }
  }

  if (scheduledDates.length === 0) {
    return { autoStatus: null, reason: null, scheduledDates };
  }
  if (lateReason) {
    return { autoStatus: "forfeited_late", reason: lateReason, scheduledDates };
  }
  if (absentReason) {
    return { autoStatus: "pending_review", reason: absentReason, scheduledDates };
  }
  return {
    autoStatus: "qualified",
    reason: `On-time on all ${scheduledDates.length} scheduled day(s) this week.`,
    scheduledDates,
  };
}

/**
 * Split a weekly-aware hours result into per-workweek regular/OT/DT totals plus
 * the latest worked date in each week (the representative day the differential
 * is attached to on the payroll batch).
 */
export function weeklyHoursByWorkweek(
  weekly: WeeklyHoursResult,
  workweekStartDay: number,
): Map<string, { regularHours: number; overtimeHours: number; doubleTimeHours: number; latestDate: string }> {
  const byWeek = new Map<
    string,
    { regularHours: number; overtimeHours: number; doubleTimeHours: number; latestDate: string }
  >();
  for (const d of weekly.days) {
    const key = workweekStartFor(d.date, workweekStartDay);
    const cur = byWeek.get(key);
    if (!cur) {
      byWeek.set(key, {
        regularHours: d.regularHours,
        overtimeHours: d.overtimeHours,
        doubleTimeHours: d.doubleTimeHours,
        latestDate: d.date,
      });
    } else {
      cur.regularHours = round2(cur.regularHours + d.regularHours);
      cur.overtimeHours = round2(cur.overtimeHours + d.overtimeHours);
      cur.doubleTimeHours = round2(cur.doubleTimeHours + d.doubleTimeHours);
      if (d.date > cur.latestDate) cur.latestDate = d.date;
    }
  }
  return byWeek;
}

export interface UpsertPunctualityWeekParams {
  employeeId: string;
  weekStartDate: string;
  autoStatus: "qualified" | "forfeited_late" | "pending_review";
  reason: string | null;
  bonusPerHour: number;
  hours: { regularHours: number; overtimeHours: number; doubleTimeHours: number };
  overtimeMultiplier: number;
  doubleTimeMultiplier: number;
}

/**
 * Insert or refresh the punctuality-bonus row for one (employee, week).
 *
 * A manager decision (`granted`/`denied`) is STICKY: once a manager has ruled on
 * a week, a later payroll re-run refreshes that week's frozen hours/multipliers
 * (so the paid amount tracks the current hours) but never reverts the status
 * back to an auto value. Auto statuses (qualified / forfeited_late /
 * pending_review) are always recomputed from source data. Returns the final row.
 */
export async function upsertPunctualityBonusWeek(
  txDb: DbOrTx,
  params: UpsertPunctualityWeekParams,
): Promise<PunctualityBonusWeek> {
  const {
    employeeId,
    weekStartDate,
    autoStatus,
    reason,
    bonusPerHour,
    hours,
    overtimeMultiplier,
    doubleTimeMultiplier,
  } = params;

  const [existing] = await txDb
    .select()
    .from(punctualityBonusWeeks)
    .where(
      and(
        eq(punctualityBonusWeeks.employeeId, employeeId),
        eq(punctualityBonusWeeks.weekStartDate, weekStartDate),
      ),
    );

  const managerDecided = existing && (existing.status === "granted" || existing.status === "denied");
  const finalStatus: PunctualityBonusStatus = managerDecided
    ? (existing!.status as PunctualityBonusStatus)
    : autoStatus;

  const differential = computePunctualityDifferential(hours, bonusPerHour, overtimeMultiplier, doubleTimeMultiplier);
  const bonusAmount = isPayablePunctualityStatus(finalStatus) ? differential : 0;

  const values = {
    employeeId,
    weekStartDate,
    status: finalStatus,
    // Keep the manager's note on a decided week; otherwise use the auto reason.
    reason: managerDecided ? (existing!.reason ?? reason) : reason,
    bonusPerHour: round2(bonusPerHour),
    regularHours: round2(hours.regularHours || 0),
    overtimeHours: round2(hours.overtimeHours || 0),
    doubleTimeHours: round2(hours.doubleTimeHours || 0),
    overtimeMultiplier,
    doubleTimeMultiplier,
    bonusAmount,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await txDb
      .update(punctualityBonusWeeks)
      .set(values)
      .where(eq(punctualityBonusWeeks.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await txDb.insert(punctualityBonusWeeks).values(values).returning();
  return created;
}

/**
 * Recompute every workweek's punctuality-bonus row for one employee over a
 * payroll period, and return a map of workweek-start → the payable differential
 * plus the representative day it should be attached to. Only workweeks that
 * actually pay (final status qualified/granted) appear in the returned map; the
 * DB rows are written for every evaluated week regardless of status.
 *
 * Intended to be called INSIDE the payroll-export transaction so the rows and
 * the batch's bonus amounts are written atomically. The `weekly` hours must be
 * the SAME weekly-aware split the batch is built from, so the stored/paid amount
 * matches the batch exactly.
 */
export async function recomputePunctualityForEmployee(
  txDb: DbOrTx,
  args: {
    employeeId: string;
    rangeStart: string;
    rangeEnd: string;
    workweekStartDay: number;
    graceMinutes: number;
    timezone: string;
    bonusPerHour: number;
    overtimeMultiplier: number;
    doubleTimeMultiplier: number;
    schedules: EmployeeSchedule[];
    punches: PunchLog[];
    approvedTimeOff: TimeOffRequest[];
    weekly: WeeklyHoursResult;
  },
): Promise<Map<string, { amount: number; representativeDate: string; status: PunctualityBonusStatus }>> {
  const byWeek = weeklyHoursByWorkweek(args.weekly, args.workweekStartDay);

  // Every workweek that produced hours, PLUS every workweek spanned by the pay
  // period (so a fully-absent week still gets a row for a manager to review).
  const weekStarts = new Set<string>(byWeek.keys());
  {
    let cursor = workweekStartFor(args.rangeStart, args.workweekStartDay);
    let safety = 0;
    while (cursor <= args.rangeEnd && safety < 400) {
      weekStarts.add(cursor);
      cursor = addDays(cursor, 7);
      safety++;
    }
  }

  const out = new Map<string, { amount: number; representativeDate: string; status: PunctualityBonusStatus }>();

  for (const weekStartDate of weekStarts) {
    const evalResult = evaluatePunctualityWeek({
      weekStartDate,
      workweekStartDay: args.workweekStartDay,
      rangeStart: args.rangeStart,
      rangeEnd: args.rangeEnd,
      graceMinutes: args.graceMinutes,
      timezone: args.timezone,
      schedules: args.schedules,
      punches: args.punches,
      approvedTimeOff: args.approvedTimeOff,
    });
    if (evalResult.autoStatus === null) continue; // no scheduled days in range

    const hours = byWeek.get(weekStartDate) ?? {
      regularHours: 0,
      overtimeHours: 0,
      doubleTimeHours: 0,
      latestDate: weekStartDate,
    };

    const row = await upsertPunctualityBonusWeek(txDb, {
      employeeId: args.employeeId,
      weekStartDate,
      autoStatus: evalResult.autoStatus,
      reason: evalResult.reason,
      bonusPerHour: args.bonusPerHour,
      hours,
      overtimeMultiplier: args.overtimeMultiplier,
      doubleTimeMultiplier: args.doubleTimeMultiplier,
    });

    if (isPayablePunctualityStatus(row.status as PunctualityBonusStatus) && row.bonusAmount > 0) {
      out.set(weekStartDate, {
        amount: row.bonusAmount,
        representativeDate: hours.latestDate,
        status: row.status as PunctualityBonusStatus,
      });
    }
  }

  return out;
}

/** List every punctuality-bonus week for a set of employees (newest week first). */
export async function listPunctualityBonusWeeksForEmployees(
  employeeIds: string[],
  filter?: { status?: PunctualityBonusStatus },
): Promise<PunctualityBonusWeek[]> {
  if (employeeIds.length === 0) return [];
  const conds = [inArray(punctualityBonusWeeks.employeeId, employeeIds)];
  if (filter?.status) conds.push(eq(punctualityBonusWeeks.status, filter.status));
  const rows = await db
    .select()
    .from(punctualityBonusWeeks)
    .where(and(...conds));
  rows.sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
  return rows;
}

export async function getPunctualityBonusWeek(id: string): Promise<PunctualityBonusWeek | undefined> {
  const [row] = await db.select().from(punctualityBonusWeeks).where(eq(punctualityBonusWeeks.id, id));
  return row;
}

/**
 * Apply a manager's approve/deny decision to a pending_review week. Recomputes
 * the payable amount from the week's frozen hours. Returns the updated row, or
 * null when the row is not in `pending_review` (already decided / auto).
 */
export async function decidePunctualityBonusWeek(
  id: string,
  decision: "approve" | "deny",
  deciderUserId: string,
  note?: string,
): Promise<PunctualityBonusWeek | null> {
  const existing = await getPunctualityBonusWeek(id);
  if (!existing) return null;
  if (existing.status !== "pending_review") return null;

  const status: PunctualityBonusStatus = decision === "approve" ? "granted" : "denied";
  const differential = computePunctualityDifferential(
    {
      regularHours: existing.regularHours,
      overtimeHours: existing.overtimeHours,
      doubleTimeHours: existing.doubleTimeHours,
    },
    existing.bonusPerHour,
    existing.overtimeMultiplier,
    existing.doubleTimeMultiplier,
  );
  const bonusAmount = status === "granted" ? differential : 0;
  const reason = note && note.trim() ? `${existing.reason ?? ""}${existing.reason ? " — " : ""}Manager ${decision === "approve" ? "approved" : "denied"}: ${note.trim()}` : existing.reason;

  const [updated] = await db
    .update(punctualityBonusWeeks)
    .set({
      status,
      bonusAmount,
      reason,
      decidedBy: deciderUserId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(punctualityBonusWeeks.id, id))
    .returning();
  return updated;
}
