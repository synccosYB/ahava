/**
 * THE single authoritative attendance / payroll calculation engine.
 *
 * Every consumer that needs to turn raw hours-worked into regular / overtime /
 * double-time hours — or into actual pay dollars — MUST go through this module,
 * so the numbers are identical on the dashboard, the timesheet, the reports, the
 * payroll batch, the CSV export and the reconciliation tools. Before this engine
 * existed those numbers were computed ~5 different ways (some hard-coded
 * "hours - days*8", some per-day threshold, some with double-time, some without),
 * which is exactly the drift this module eliminates.
 *
 * Policy-version awareness: the pay-affecting knobs are captured into a
 * `PayCalcPolicy` snapshot. When a payroll batch is created, that snapshot is
 * frozen onto each batch record (see payroll_batch_records snapshot columns), so
 * a historical period recomputes IDENTICALLY even after the live policy is later
 * edited (policy.version bumps but the frozen snapshot never changes).
 *
 * The multipliers and thresholds are NEVER hard-coded here — they are read from
 * the resolved attendance / payroll / pto policy and only fall back to the
 * shared DEFAULT_* rule sets when a policy omits a key.
 */
import type { User } from "@shared/schema";
import {
  getEffectivePolicy,
  DEFAULT_ATTENDANCE_RULES,
  DEFAULT_PAYROLL_RULES,
  DEFAULT_PTO_RULES,
} from "./policyEngine";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The frozen set of pay-affecting policy values for one employee. This is what
 * gets snapshotted onto payroll batch records for version-stable recompute.
 */
export interface PayCalcPolicy {
  /** Daily hours after which overtime begins (attendance policy). */
  otThresholdDaily: number;
  /** Daily hours after which double-time begins (payroll policy); null disables. */
  doubleTimeThresholdDaily: number | null;
  /** Pay multiplier applied to overtime hours (payroll policy, default 1.5x). */
  overtimeMultiplier: number;
  /** Pay multiplier applied to double-time hours (payroll policy, default 2.0x). */
  doubleTimeMultiplier: number;
  /** Master OT switch. Treated as true unless explicitly false. */
  autoCalculateOT: boolean;
  /** Per-rule OT switch. Treated as true unless explicitly false. */
  overtimeEnabled: boolean;
  /** Per-rule double-time switch. Treated as true unless explicitly false. */
  doubleTimeEnabled: boolean;
  /** Whether holiday pay is enabled (pto policy). */
  holidayPayEnabled: boolean;
  /** When true, hours worked on a holiday are excluded from OT/DT (pto policy). */
  holidayOtExclusion: boolean;
  /** Version of the attendance policy that produced these values (audit/freeze). */
  attendancePolicyVersion: number | null;
  /** Version of the payroll policy that produced these values (audit/freeze). */
  payrollPolicyVersion: number | null;
}

export const DEFAULT_PAY_CALC_POLICY: PayCalcPolicy = {
  otThresholdDaily: DEFAULT_ATTENDANCE_RULES.otThresholdDaily,
  doubleTimeThresholdDaily: DEFAULT_PAYROLL_RULES.doubleTimeThresholdDaily,
  overtimeMultiplier: DEFAULT_PAYROLL_RULES.overtimeMultiplier,
  doubleTimeMultiplier: DEFAULT_PAYROLL_RULES.doubleTimeMultiplier,
  autoCalculateOT: DEFAULT_PAYROLL_RULES.autoCalculateOT,
  overtimeEnabled: DEFAULT_PAYROLL_RULES.overtimeEnabled,
  doubleTimeEnabled: DEFAULT_PAYROLL_RULES.doubleTimeEnabled,
  holidayPayEnabled: DEFAULT_PTO_RULES.holidayPayEnabled,
  holidayOtExclusion: DEFAULT_PTO_RULES.holidayOtExclusion,
  attendancePolicyVersion: null,
  payrollPolicyVersion: null,
};

/**
 * Merge raw attendance / payroll / pto rule objects (any of which may be
 * undefined) into a single PayCalcPolicy, falling back to DEFAULT_* per key.
 * The on/off toggles mirror enforceClockOut: missing flags are treated as `true`
 * so policies saved before the toggles existed keep computing OT/DT as before.
 */
export function buildPayCalcPolicy(
  attendanceRules?: Record<string, any>,
  payrollRules?: Record<string, any>,
  ptoRules?: Record<string, any>,
  versions?: { attendance?: number | null; payroll?: number | null },
): PayCalcPolicy {
  const att = attendanceRules || {};
  const pay = payrollRules || {};
  const pto = ptoRules || {};
  return {
    otThresholdDaily: att.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily,
    doubleTimeThresholdDaily:
      pay.doubleTimeThresholdDaily ?? DEFAULT_PAYROLL_RULES.doubleTimeThresholdDaily,
    overtimeMultiplier: pay.overtimeMultiplier ?? DEFAULT_PAYROLL_RULES.overtimeMultiplier,
    doubleTimeMultiplier: pay.doubleTimeMultiplier ?? DEFAULT_PAYROLL_RULES.doubleTimeMultiplier,
    autoCalculateOT: pay.autoCalculateOT !== false,
    overtimeEnabled: pay.overtimeEnabled !== false,
    doubleTimeEnabled: pay.doubleTimeEnabled !== false,
    holidayPayEnabled: pto.holidayPayEnabled ?? DEFAULT_PTO_RULES.holidayPayEnabled,
    holidayOtExclusion: pto.holidayOtExclusion ?? DEFAULT_PTO_RULES.holidayOtExclusion,
    attendancePolicyVersion: versions?.attendance ?? null,
    payrollPolicyVersion: versions?.payroll ?? null,
  };
}

/**
 * Resolve the full PayCalcPolicy for an employee via the policy-engine
 * hierarchy (employee > pay_type > employment_type > role > department >
 * location > division > global). Reads attendance + payroll + pto policies.
 */
export async function resolvePayCalcPolicy(employee: User): Promise<PayCalcPolicy> {
  const [att, pay, pto] = await Promise.all([
    getEffectivePolicy(employee.companyId, employee.id, "attendance", employee),
    getEffectivePolicy(employee.companyId, employee.id, "payroll", employee),
    getEffectivePolicy(employee.companyId, employee.id, "pto", employee),
  ]);
  return buildPayCalcPolicy(att?.rules, pay?.rules, pto?.rules, {
    attendance: att?.version ?? null,
    payroll: pay?.version ?? null,
  });
}

export interface DailyHoursSplit {
  /** Total hours worked that day (the input, normalized to >= 0, 2dp). */
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  status: "complete" | "overtime";
}

/**
 * Split a single day's hours-worked into regular / overtime / double-time using
 * the resolved policy. This is the canonical daily split — the exact logic that
 * used to live (only) inside enforceClockOut, now shared by everyone.
 *
 *   regular     = hours up to otThresholdDaily
 *   overtime    = hours from otThresholdDaily up to doubleTimeThresholdDaily
 *   double-time = hours beyond doubleTimeThresholdDaily
 *
 * When the day is a holiday and the policy sets holidayOtExclusion, all hours
 * stay regular (holiday hours are excluded from OT/DT).
 */
export function splitDailyHours(
  hoursWorked: number,
  policy: PayCalcPolicy,
  opts?: { isHoliday?: boolean },
): DailyHoursSplit {
  const hours = round2(Math.max(0, hoursWorked || 0));
  const holidayExcludesOt = !!opts?.isHoliday && policy.holidayOtExclusion;

  let regularHours = hours;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  let status: "complete" | "overtime" = "complete";

  if (
    !holidayExcludesOt &&
    policy.autoCalculateOT &&
    policy.overtimeEnabled &&
    hours > policy.otThresholdDaily
  ) {
    status = "overtime";
    const dt = policy.doubleTimeThresholdDaily;
    if (policy.doubleTimeEnabled && dt && hours > dt) {
      doubleTimeHours = round2(hours - dt);
      overtimeHours = round2(dt - policy.otThresholdDaily);
    } else {
      overtimeHours = round2(hours - policy.otThresholdDaily);
    }
    regularHours = round2(hours - overtimeHours - doubleTimeHours);
  }

  return { hoursWorked: hours, regularHours, overtimeHours, doubleTimeHours, status };
}

/**
 * Gross pay for a worked-hours split, applying the policy multipliers. Regular
 * hours pay at base rate, overtime at overtimeMultiplier, double-time at
 * doubleTimeMultiplier. Multipliers come from the (possibly snapshotted) policy.
 */
export function computeGrossPay(
  split: { regularHours: number; overtimeHours: number; doubleTimeHours: number },
  hourlyRate: number,
  mult: { overtimeMultiplier: number; doubleTimeMultiplier: number },
): number {
  const rate = hourlyRate || 0;
  return round2(
    split.regularHours * rate +
      split.overtimeHours * rate * mult.overtimeMultiplier +
      split.doubleTimeHours * rate * mult.doubleTimeMultiplier,
  );
}

export interface RangeHoursSummary {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  daysWorked: number;
}

/**
 * Aggregate a set of per-day hours into range totals, applying the daily split
 * to EACH day (so a long day and a short day don't net against each other the
 * way the old "totalHours - daysWorked*8" formula did). Days with <= 0 hours are
 * ignored and don't count toward daysWorked.
 */
export function summarizeDailyHours(
  dailyHours: Array<{ hours: number; isHoliday?: boolean }>,
  policy: PayCalcPolicy,
): RangeHoursSummary {
  let totalHours = 0;
  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  let daysWorked = 0;
  for (const d of dailyHours) {
    if (!d.hours || d.hours <= 0) continue;
    daysWorked++;
    const s = splitDailyHours(d.hours, policy, { isHoliday: d.isHoliday });
    totalHours += s.hoursWorked;
    regularHours += s.regularHours;
    overtimeHours += s.overtimeHours;
    doubleTimeHours += s.doubleTimeHours;
  }
  return {
    totalHours: round2(totalHours),
    regularHours: round2(regularHours),
    overtimeHours: round2(overtimeHours),
    doubleTimeHours: round2(doubleTimeHours),
    daysWorked,
  };
}
