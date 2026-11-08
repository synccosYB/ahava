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

// --- Lunch-required employees: full day adjustment ---------------------------

export interface LunchDayPunch {
  clockIn: Date | null;
  /** Real clock-out. Null when the punch is open or only a missing-punch placeholder. */
  clockOut: Date | null;
  /** A genuinely in-progress punch (clocked in, not out, not a marked missing punch). */
  openInProgress: boolean;
}

export interface LunchAdjustOptions {
  /** Flat lunch docked when no proper lunch was taken. Default 45. */
  fineMinutes?: number;
  /** Only dock the fine on a shift at least this long (owes a lunch). Default 6h. */
  breakThresholdHours?: number;
}

/**
 * Final paid day-hours for a LUNCH-REQUIRED employee, from the day's punches and
 * the naive base worked hours (sum of each completed punch's worked hours).
 *
 * Rules (confirmed with the owner):
 *  - Clocked out and back WITHIN the hour  -> clean lunch, PAID up to 45 min
 *    (base + paidLunch); over 45 of it is unpaid.
 *  - Clocked out and back AFTER the hour    -> two separate shifts, lunch unpaid,
 *    no fine (they did clock out and in) -> base unchanged.
 *  - NO proper lunch (worked straight through, or clocked out and never clocked
 *    back in) -> the day's paid span is first-punch to last-punch minus a flat
 *    45-min fine, but only once the day is over and only on a shift >= the break
 *    threshold (short shifts don't owe a lunch).
 *
 * Pure — unit-tested in isolation.
 */
export function computeLunchAdjustedHours(
  punches: LunchDayPunch[],
  baseWorkedHours: number,
  opts: LunchAdjustOptions = {},
): number {
  const fineHours = (opts.fineMinutes ?? PAID_LUNCH_CAP_MINUTES) / 60;
  const breakThresholdHours = opts.breakThresholdHours ?? 6;

  const segments: ShiftInterval[] = punches
    .filter((p) => p.clockIn && p.clockOut)
    .map((p) => ({ clockIn: p.clockIn as Date, clockOut: p.clockOut as Date }));

  const lb = computeLunchBreaks(segments);

  // A clean lunch (a gap that stayed within the hour) -> paid, capped at 45.
  if (lb.qualifyingBreakMinutes > 0) {
    return baseWorkedHours + lb.paidLunchMinutes / 60;
  }

  // Day not over yet (someone is still clocked in) -> defer; don't fine mid-shift.
  if (punches.some((p) => p.openInProgress)) return baseWorkedHours;

  // Clocked out and back, but over the hour -> two separate shifts, lunch unpaid,
  // no fine (they DID clock out and back in).
  if (segments.length >= 2 && lb.newShiftGaps > 0) return baseWorkedHours;

  // No proper lunch taken -> fine. The paid span is first punch to last punch.
  const instants: number[] = [];
  for (const p of punches) {
    if (p.clockIn) instants.push(p.clockIn.getTime());
    if (p.clockOut) instants.push(p.clockOut.getTime());
  }
  if (instants.length === 0) return baseWorkedHours;
  const spanHours = (Math.max(...instants) - Math.min(...instants)) / 3_600_000;
  if (spanHours < breakThresholdHours) return baseWorkedHours; // too short to owe a lunch
  return Math.max(0, spanHours - fineHours);
}
