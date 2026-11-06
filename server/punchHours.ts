/**
 * Canonical per-punch hours-worked computation. This is the single source of
 * truth for the derived `punch_logs.hours_worked` value. It mirrors the exact
 * formula used at clock-out (`storage.clockOut`): elapsed wall-clock between the
 * (rounded) clock-in and (rounded) clock-out, minus break minutes, rounded to
 * two decimals.
 *
 * It is reused by both clock-out and the attendance reconciliation tool so they
 * can never drift apart. Kept in its own dependency-free module to avoid a
 * circular import between `storage.ts` and `timesheetService.ts`.
 *
 * Returns `null` for a punch that cannot yield a finished value (no clock-in,
 * or still in-progress with no clock-out) — callers should leave such punches
 * untouched rather than zeroing them.
 */
/**
 * Status marking a shift whose clock-out is MISSING because it ran past the
 * max-shift limit with no punch-out (a forgotten punch-out). It is NOT a worked
 * shift: its hours are unverified (treated as 0 / null) until a manager enters
 * the real clock-out. Kept here, dependency-free, so every hours surface
 * (timesheet, ledger, the SQL aggregates, reconciliation) keys off one constant.
 */
export const MISSING_CLOCKOUT_STATUS = "missing_clockout";

/**
 * A punch that has a clock-OUT but no clock-IN (the employee forgot to clock in
 * and only clocked out). Like a missing clock-out it is a MISSING PUNCH, not an
 * in-progress shift: hours are unverified (null) until a manager enters the real
 * clock-in. Mirrors MISSING_CLOCKOUT_STATUS for the clock-in side.
 */
export const MISSING_CLOCKIN_STATUS = "missing_clockin";

/**
 * A shift that closed with a span in the "approval band" (>= maxShiftHours and
 * < maxShiftApprovalHours, e.g. 13–16h). It is NOT auto-marked a missing punch:
 * it's closed provisionally with its real hours and held for an admin/manager to
 * decide — keep the long shift, or treat it as a forgotten punch-out (missing
 * punch + a fresh shift). Hours count provisionally until resolved.
 */
export const PENDING_APPROVAL_STATUS = "pending_approval";

/**
 * True when an OPEN punch (no clock-out) has already run past the employee's
 * max-shift limit — i.e. the employee forgot to punch out. Such a punch is a
 * missing punch: its hours must NOT accrue (and must not be "capped" at the
 * limit either — that would record hours the employee may not have worked).
 * The live hours surfaces use this to contribute 0 for such a punch instead of
 * a runaway clock-in→now total.
 */
export function openPunchExceedsMaxShift(
  punch: { clockIn: Date | string | null; clockOut: Date | string | null; roundedClockIn?: Date | string | null },
  now: Date,
  maxShiftHours: number,
): boolean {
  if (punch.clockOut) return false;
  const startRaw = punch.roundedClockIn ?? punch.clockIn;
  if (!startRaw) return false;
  const start = new Date(startRaw).getTime();
  if (!Number.isFinite(start)) return false;
  return now.getTime() - start > maxShiftHours * 60 * 60 * 1000;
}

export function computePunchHoursWorked(punch: {
  clockIn: Date | string | null;
  clockOut: Date | string | null;
  roundedClockIn?: Date | string | null;
  roundedClockOut?: Date | string | null;
  breakMinutes?: number | null;
  status?: string | null;
}): number | null {
  // A missing-clock-out (placeholder out) or missing-clock-in punch yields no
  // verified hours until the real time is entered.
  if (punch.status === MISSING_CLOCKOUT_STATUS || punch.status === MISSING_CLOCKIN_STATUS) return null;
  const startRaw = punch.roundedClockIn ?? punch.clockIn;
  const endRaw = punch.roundedClockOut ?? punch.clockOut;
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw).getTime();
  const end = new Date(endRaw).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const breakMs = (punch.breakMinutes || 0) * 60 * 1000;
  return Math.round(((end - start - breakMs) / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * Whole minutes elapsed for an in-progress break, from its start timestamp to
 * `now`. This is the SINGLE formula used when ending a break — the result is
 * folded into `punch_logs.break_minutes` (the one break accumulator every pay
 * surface subtracts), so breaks are never double-counted. Never negative.
 */
export function computeBreakElapsedMinutes(
  breakStartedAt: Date | string | null | undefined,
  now: Date | number = Date.now(),
): number {
  if (!breakStartedAt) return 0;
  const start = new Date(breakStartedAt).getTime();
  const end = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}
