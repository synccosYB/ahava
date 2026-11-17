/**
 * Smart in/out pairing for employee-submitted missing-punch corrections.
 *
 * The employee enters the real time(s) they punched — they do NOT have to say
 * which is the clock-in and which is the clock-out. Given those time(s) plus any
 * punch already on that day, this suggests the complete shift. Direction is
 * INFERRED, not dictated:
 *   - Same-day worker: the earlier time is the clock-in, the later the clock-out.
 *   - Overnight worker (overnightShiftsAllowed): a pair that would otherwise imply
 *     an implausibly long same-day shift is read as crossing midnight instead
 *     (evening time = clock-in, early-morning time = clock-out the next day).
 *
 * The suggestion is advisory — an admin reviews and can adjust before approving.
 * This module is pure (no DB/IO) so it is easy to test and reuse.
 */

export type PairingPunch = { id: string; clockIn: Date | string | null; clockOut: Date | string | null };

export type PairingSuggestion = {
  clockIn: Date;
  clockOut: Date;
  /** Existing punch to UPDATE (so we don't create a duplicate), or null = create new. */
  targetPunchId: string | null;
  action: "update" | "create";
  overnight: boolean;
  note: string;
};

export type PairingResult = PairingSuggestion | { error: string };

// A same-day shift longer than this is implausible; for an overnight-enabled
// employee it signals the pair actually crosses midnight.
const OVERNIGHT_SPAN_THRESHOLD_HOURS = 12;

function toDate(v: Date | string | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function suggestShiftPairing(params: {
  /** The time(s) the employee entered (one for a lone-missing side, two for a fully-missed day). */
  enteredTimes: (Date | string)[];
  /** Punches already recorded on that work date (0 or 1 for the pairing case). */
  existingPunches: PairingPunch[];
  overnightAllowed: boolean;
}): PairingResult {
  const existing = params.existingPunches;

  if (existing.length > 1) {
    return { error: "More than one punch on this day — resolve it manually (which punch to fix is ambiguous)." };
  }

  // A single, already-complete punch isn't a missing-punch pairing — it's a time
  // correction on an existing shift.
  if (existing.length === 1) {
    const only = existing[0];
    if (toDate(only.clockIn) && toDate(only.clockOut)) {
      return { error: "This day's shift is already complete — use a time correction to change a punched time." };
    }
  }

  const existingTimes: Date[] = [];
  for (const p of existing) {
    const ci = toDate(p.clockIn);
    const co = toDate(p.clockOut);
    if (ci) existingTimes.push(ci);
    if (co) existingTimes.push(co);
  }
  const entered = params.enteredTimes.map(toDate).filter((d): d is Date => d != null);

  const all = [...existingTimes, ...entered];
  if (all.length < 2) {
    return { error: "Need two times to pair a shift — enter the missing time (or both, for a fully-missed day)." };
  }

  // The shift's boundaries are the earliest and latest of all known times.
  const sorted = [...all].sort((a, b) => a.getTime() - b.getTime());
  let clockIn = sorted[0];
  let clockOut = sorted[sorted.length - 1];
  let overnight = false;

  const spanHours = (clockOut.getTime() - clockIn.getTime()) / 3_600_000;
  if (params.overnightAllowed && spanHours > OVERNIGHT_SPAN_THRESHOLD_HOURS) {
    // Cross-midnight read: the late (evening) time is the clock-in; the early
    // (morning) time is the clock-out on the NEXT day.
    const evening = clockOut;
    const nextMorning = new Date(clockIn.getTime() + 24 * 3_600_000);
    clockIn = evening;
    clockOut = nextMorning;
    overnight = true;
  }

  const targetPunchId = existing.length === 1 ? existing[0].id : null;
  return {
    clockIn,
    clockOut,
    targetPunchId,
    action: targetPunchId ? "update" : "create",
    overnight,
    note: overnight
      ? "Overnight shift: evening clock-in paired with the next-morning clock-out."
      : "Same-day shift: the earlier time is the clock-in, the later time is the clock-out.",
  };
}
