/**
 * Lunch-break pay (F6). At Ahava, breaks are taken by clocking OUT and back IN,
 * so a "break" is the GAP between one punch-out and the next punch-in on the
 * same day. The rules (confirmed with the owner):
 *
 *  - Daily break allowance = 60 total minutes. Gaps are counted in order; a gap
 *    stays a BREAK while the running break total is <= 60 min.
 *  - The gap that would push the day's break total OVER 60 min is NOT a break —
 *    it's a new shift (unpaid gap). A single gap over 60 (e.g. 1h15m) is a new
 *    shift on its own.
 *  - Of the qualifying break minutes, 45 are PAID (added back as paid time, since
 *    the person is clocked out during lunch); minutes 45→60 are unpaid.
 *  - Paid lunch = total qualifying break minutes, capped at 45 (what they took,
 *    max 45).
 *
 * Worked examples (all covered by the test):
 *  - one 60-min break      -> qualifies, paid 45, 15 unpaid.
 *  - one 75-min break      -> new shift, 0 lunch pay.
 *  - 20 + 20 + 30 breaks   -> first two qualify (40 paid); the 30 pushes the
 *                             total to 70 -> new shift, not paid; day paid = 40.
 *
 * This module is PURE (no DB) so the math is unit-tested in isolation; the pay
 * engine adds `paidLunchMinutes` to the day's paid time.
 */

export const DAILY_BREAK_CAP_MINUTES = 60;
export const PAID_LUNCH_CAP_MINUTES = 45;

export interface ShiftInterval {
  clockIn: Date;
  clockOut: Date | null;
}

export interface LunchBreakResult {
  /** Paid lunch minutes to ADD to the day's paid time (0–45). */
  paidLunchMinutes: number;
  /** Total qualifying break minutes (gaps counted as breaks, capped at 60). */
  qualifyingBreakMinutes: number;
  /** Qualifying break minutes that are NOT paid (the 45→60 portion). */
  unpaidBreakMinutes: number;
  /** Number of gaps that were too long to be a break -> treated as a new shift. */
  newShiftGaps: number;
}

/**
 * Given a day's shift intervals (each a clock-in/out pair), classify the gaps
 * between them and compute the paid lunch for that day.
 */
export function computeLunchBreaks(intervals: ShiftInterval[]): LunchBreakResult {
  // Only completed pairs can bound a gap; order by clock-in.
  const pairs = intervals
    .filter((p): p is { clockIn: Date; clockOut: Date } => !!p.clockIn && !!p.clockOut)
    .slice()
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());

  let cumulative = 0; // running qualifying break minutes
  let paid = 0;
  let newShiftGaps = 0;

  for (let i = 0; i < pairs.length - 1; i++) {
    const gapMs = pairs[i + 1].clockIn.getTime() - pairs[i].clockOut.getTime();
    if (gapMs <= 0) continue; // contiguous or overlapping — not a break
    const gapMin = gapMs / 60000;

    if (cumulative + gapMin <= DAILY_BREAK_CAP_MINUTES) {
      // Qualifying break. Pay the portion that stays within the 45-min cap.
      const next = cumulative + gapMin;
      paid += Math.min(next, PAID_LUNCH_CAP_MINUTES) - Math.min(cumulative, PAID_LUNCH_CAP_MINUTES);
      cumulative = next;
    } else {
      // This gap pushes the day over the 60-min allowance -> a new shift.
      newShiftGaps += 1;
    }
  }

  return {
    paidLunchMinutes: paid,
    qualifyingBreakMinutes: cumulative,
    unpaidBreakMinutes: Math.max(0, cumulative - PAID_LUNCH_CAP_MINUTES),
    newShiftGaps,
  };
}

/** Convenience: paid lunch for a day, in HOURS, to add to paid time. */
export function paidLunchHours(intervals: ShiftInterval[]): number {
  return computeLunchBreaks(intervals).paidLunchMinutes / 60;
}
