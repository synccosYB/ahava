import type { PunchLog } from "@shared/schema";
import { MISSING_CLOCKIN_STATUS, MISSING_CLOCKOUT_STATUS, openPunchExceedsMaxShift } from "./punchHours";
import { computeLunchAdjustedHours } from "./services/lunchBreak";

/** Shared worked-hours input for the attendance ledger and PTO accrual. */
export function punchWorkedHours(p: PunchLog, now: Date, maxShiftHours: number): number {
  if (p.status === MISSING_CLOCKOUT_STATUS || p.status === MISSING_CLOCKIN_STATUS) return 0;
  // Zero is a verified value, not a reason to reconstruct elapsed hours.
  if (p.hoursWorked != null) return p.hoursWorked;
  if (!p.clockIn || openPunchExceedsMaxShift(p, now, maxShiftHours)) return 0;
  const start = new Date(p.roundedClockIn ?? p.clockIn).getTime();
  const end = p.clockOut ? new Date(p.roundedClockOut ?? p.clockOut).getTime() : now.getTime();
  if (!(end > start)) return 0;
  return Math.max(0, (end - start) / 3_600_000 - (p.breakMinutes || 0) / 60);
}

export interface WorkedHoursRules {
  maxShiftHours: number;
  requireLunchBreak: boolean;
  lunchDeductionEnabled: boolean;
  breakThresholdHours: number;
}

export function workedDayHours(
  punches: PunchLog[],
  now: Date,
  rules: WorkedHoursRules,
  // Preserve imported historical PTO hours that have no clock timestamps.
  includeHoursWithoutClockIn = false,
): number {
  const inputs = punches.filter(p => p.clockIn || includeHoursWithoutClockIn);
  const baseHours = inputs.reduce((sum, p) => sum + punchWorkedHours(p, now, rules.maxShiftHours), 0);
  if (baseHours <= 0) return 0;
  const adjusted = computeLunchAdjustedHours(inputs.filter(p => p.clockIn).map(p => ({
    clockIn: new Date(p.roundedClockIn ?? p.clockIn!),
    clockOut: p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS
      ? new Date(p.roundedClockOut ?? p.clockOut) : null,
    openInProgress: p.status !== MISSING_CLOCKOUT_STATUS &&
      (p.status === "in-progress" || (!p.clockOut && p.hoursWorked == null)),
  })), baseHours, {
    breakThresholdHours: rules.breakThresholdHours,
    applyFine: rules.requireLunchBreak && rules.lunchDeductionEnabled,
  });
  return Math.round(adjusted * 100) / 100;
}
