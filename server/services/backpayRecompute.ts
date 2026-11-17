/**
 * Back-pay owed-delta calculator (pure).
 *
 * When an attendance correction lands on a day that was already PAID in a
 * finalized payroll export, we don't block it — we update the timesheet and pay
 * the difference on the next payroll. "Full weekly recompute" (the chosen
 * policy): recompute the ENTIRE affected workweek's reg/OT/DT split from the
 * CORRECTED punches, using the SAME frozen policy snapshot the source export was
 * built with, then subtract what that export already paid for the same days. The
 * signed remainder is the back-pay (positive) or claw-back (negative).
 *
 * Recomputing the whole week (not just the touched day) is what makes weekly
 * overtime correct: adding hours to one day can reclassify regular hours on
 * later days into weekly OT, and that reclassification must be reflected.
 *
 * This module is pure (no DB/IO): the caller supplies the week's corrected hours,
 * what was already paid per day, the frozen policy, and the frozen rate snapshot.
 */
import { computeWeeklyHours, round2, type PayCalcPolicy } from "../payrollEngine";

export interface PaidDaySplit {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
}

export interface BackpayDelta {
  /** Signed hour deltas (corrected week total − already-paid week total). */
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  /** True when every delta is ~0 — nothing to pay or claw back. */
  isZero: boolean;
  /** Frozen pay snapshot carried through so the next batch pays at the right rate. */
  hourlyRate: number | null;
  overtimeMultiplier: number | null;
  doubleTimeMultiplier: number | null;
}

// Hour deltas smaller than this (rounding dust) are treated as zero.
const EPSILON = 0.001;

export function computeBackpayDelta(params: {
  /**
   * Every day in the affected workweek that the source export covers, with the
   * CURRENT (post-correction) hours worked. Days with no/incomplete punches
   * should be passed as 0 (or omitted) — they contribute no corrected hours.
   */
  correctedDays: { date: string; hours: number; isHoliday?: boolean }[];
  /** What the source export already PAID per day (keyed YYYY-MM-DD). */
  paidByDate: Map<string, PaidDaySplit>;
  /** The frozen policy snapshot reconstructed from the source export's rows. */
  policy: PayCalcPolicy;
  /** Frozen rate/multipliers from a source batch record (for $ on the back-pay line). */
  rate: {
    hourlyRate: number | null;
    overtimeMultiplier: number | null;
    doubleTimeMultiplier: number | null;
  };
}): BackpayDelta {
  // Correct, weekly-aware split for the whole week from the corrected hours.
  const weekly = computeWeeklyHours(
    params.correctedDays.filter((d) => d.hours > 0),
    params.policy,
  );

  let correctReg = 0;
  let correctOt = 0;
  let correctDt = 0;
  for (const d of weekly.days) {
    correctReg += d.regularHours;
    correctOt += d.overtimeHours;
    correctDt += d.doubleTimeHours;
  }

  // What was already paid across the SAME set of days (the week ∩ export range).
  let paidReg = 0;
  let paidOt = 0;
  let paidDt = 0;
  const dates = new Set(params.correctedDays.map((d) => d.date));
  for (const [date, paid] of params.paidByDate) {
    if (!dates.has(date)) continue;
    paidReg += paid.regularHours;
    paidOt += paid.overtimeHours;
    paidDt += paid.doubleTimeHours;
  }

  const regularHours = round2(correctReg - paidReg);
  const overtimeHours = round2(correctOt - paidOt);
  const doubleTimeHours = round2(correctDt - paidDt);
  const isZero =
    Math.abs(regularHours) < EPSILON &&
    Math.abs(overtimeHours) < EPSILON &&
    Math.abs(doubleTimeHours) < EPSILON;

  return {
    regularHours,
    overtimeHours,
    doubleTimeHours,
    isZero,
    hourlyRate: params.rate.hourlyRate,
    overtimeMultiplier: params.rate.overtimeMultiplier,
    doubleTimeMultiplier: params.rate.doubleTimeMultiplier,
  };
}
