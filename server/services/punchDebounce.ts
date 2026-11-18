/**
 * Accidental double-punch guard. A new punch landing within a short window of the
 * employee's last clock event (clock-in or clock-out) is treated as an accidental
 * duplicate — e.g. a double-tap on the fingerprint clock — and ignored.
 *
 * Window is 3 minutes, per the owner. Pure helper so both the self-service
 * clock-in/out routes and the biometric device ingest share one rule.
 */
export const PUNCH_DEBOUNCE_MS = 3 * 60 * 1000;

/**
 * Milliseconds still remaining in the debounce window (0 when the punch is
 * allowed). `lastEvent` is the employee's most recent clock-in/out instant, or
 * null when they have no prior punch.
 */
export function punchDebounceRemaining(lastEvent: Date | null, now: Date): number {
  if (!lastEvent) return 0;
  const elapsed = now.getTime() - lastEvent.getTime();
  return elapsed >= 0 && elapsed < PUNCH_DEBOUNCE_MS ? PUNCH_DEBOUNCE_MS - elapsed : 0;
}
