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
export function computePunchHoursWorked(punch: {
  clockIn: Date | string | null;
  clockOut: Date | string | null;
  roundedClockIn?: Date | string | null;
  roundedClockOut?: Date | string | null;
  breakMinutes?: number | null;
}): number | null {
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
