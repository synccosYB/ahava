/**
 * THE single shared server-side punch-integrity validator (task #450).
 *
 * Every punch write path — employee clock-in/out, kiosk punch, manager manual
 * edit, and approved correction-request resolution — routes the proposed punch
 * through `validatePunchIntegrity` BEFORE persisting. The goal is one place that
 * rejects impossible / inconsistent punches with a specific, human-readable
 * reason, so the rules can never drift between surfaces (the DB partial unique
 * index on open punches and the client-side checks are backstops only).
 *
 * This module is intentionally PURE and synchronous (no DB, no policy lookups)
 * so it is trivially unit-testable and cheap to call on hot paths. The async
 * concerns it can't see — gathering the employee's neighbouring punches and the
 * finalized-payroll (locked-period) guard — live at the route layer, which feeds
 * the already-loaded facts into this function.
 *
 * Rejections covered here:
 *   - missing / unparseable clock-in (a punch must have a valid clock-in)
 *   - unparseable clock-out
 *   - clock-out on or before clock-in (zero / negative duration)
 *   - future-dated clock-in or clock-out (unless the caller opts in via
 *     `allowFuturePunch`, resolved from the attendance policy; default off)
 *   - a duplicate OPEN shift (employee already clocked in with no clock-out)
 *   - a shift that overlaps another of the same employee's shifts
 *
 * The locked-payroll-period guard is enforced separately at the route layer
 * (findFinalizedPayrollExportsForPunch / ...ForEmployeeDate) because it requires
 * a DB read; it returns its own 409 so the reason ("reopen the batch first")
 * stays distinct from these 400-level integrity reasons.
 */

/** A neighbouring punch used for overlap / duplicate-open detection. */
export interface ExistingPunchForValidation {
  id: string;
  clockIn: Date | string | null;
  clockOut: Date | string | null;
}

export interface PunchValidationInput {
  /**
   * The id of the punch being edited, if any. Excluded from the overlap /
   * duplicate-open scan so a punch never conflicts with itself.
   */
  punchId?: string | null;
  /** Proposed clock-in. Required — a null/undefined value is a rejection. */
  clockIn: Date | string | null | undefined;
  /**
   * Proposed clock-out. `undefined`/`null` means an open (in-progress) punch,
   * which is valid; only a NON-null unparseable value is a rejection.
   */
  clockOut?: Date | string | null | undefined;
  /** The employee's neighbouring punches for overlap detection. */
  existingPunches: ExistingPunchForValidation[];
  /** Clock to compare future-dating against. Defaults to `new Date()`. */
  now?: Date;
  /** When true, future-dated punches are permitted. Defaults to false. */
  allowFuturePunch?: boolean;
}

export interface PunchValidationResult {
  ok: boolean;
  /** Human-readable rejection reason (only set when `ok` is false). */
  reason?: string;
}

const VALID = { ok: true } as const;

function toDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** Compact, timezone-explicit timestamp for rejection messages (e.g. "2026-06-17 09:30 UTC"). */
export function formatPunchTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * Validate a single proposed punch against the integrity rules. Returns the
 * FIRST violation found (so the user gets one clear, actionable reason) or
 * `{ ok: true }`.
 */
export function validatePunchIntegrity(input: PunchValidationInput): PunchValidationResult {
  const now = input.now ?? new Date();
  const allowFuture = input.allowFuturePunch ?? false;

  // --- clock-in: required + parseable -------------------------------------
  const clockInParsed = toDate(input.clockIn);
  if (clockInParsed === undefined || clockInParsed === null) {
    return { ok: false, reason: "A punch must have a clock-in time." };
  }
  if (Number.isNaN(clockInParsed.getTime())) {
    return { ok: false, reason: "The clock-in time is not a valid date." };
  }
  const clockIn = clockInParsed;

  // --- clock-out: optional, but parseable when present --------------------
  let clockOut: Date | null = null;
  const clockOutParsed = toDate(input.clockOut);
  if (clockOutParsed !== undefined && clockOutParsed !== null) {
    if (Number.isNaN(clockOutParsed.getTime())) {
      return { ok: false, reason: "The clock-out time is not a valid date." };
    }
    clockOut = clockOutParsed;
  }

  // --- zero / negative duration -------------------------------------------
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return {
      ok: false,
      reason: `Clock-out (${formatPunchTime(clockOut)}) must be after clock-in (${formatPunchTime(clockIn)}) — a punch can't have a zero or negative duration.`,
    };
  }

  // --- future-dated --------------------------------------------------------
  if (!allowFuture) {
    const nowMs = now.getTime();
    if (clockIn.getTime() > nowMs) {
      return {
        ok: false,
        reason: `Clock-in (${formatPunchTime(clockIn)}) is in the future. Future-dated punches are not allowed.`,
      };
    }
    if (clockOut && clockOut.getTime() > nowMs) {
      return {
        ok: false,
        reason: `Clock-out (${formatPunchTime(clockOut)}) is in the future. Future-dated punches are not allowed.`,
      };
    }
  }

  // --- duplicate open shift + overlap -------------------------------------
  const newStart = clockIn.getTime();
  const newEnd = clockOut ? clockOut.getTime() : Infinity;
  const newIsOpen = newEnd === Infinity;

  for (const ex of input.existingPunches) {
    if (input.punchId && ex.id === input.punchId) continue;

    const exInParsed = ex.clockIn ? new Date(ex.clockIn) : null;
    // A neighbouring punch with no/invalid clock-in carries no interval to
    // conflict with — skip it (its own write path is responsible for it).
    if (!exInParsed || Number.isNaN(exInParsed.getTime())) continue;

    const exOutParsed = ex.clockOut ? new Date(ex.clockOut) : null;
    const exStart = exInParsed.getTime();
    const exEnd =
      exOutParsed && !Number.isNaN(exOutParsed.getTime()) ? exOutParsed.getTime() : Infinity;
    const exIsOpen = exEnd === Infinity;

    // Two open shifts can never coexist — flag this first with a specific msg.
    if (newIsOpen && exIsOpen) {
      return {
        ok: false,
        reason: `This employee already has an open shift (clocked in at ${formatPunchTime(exInParsed)}) with no clock-out. Close it before starting another.`,
      };
    }

    // Half-open interval overlap: [newStart, newEnd) ∩ [exStart, exEnd).
    if (newStart < exEnd && exStart < newEnd) {
      const exDescription = exIsOpen
        ? `an open shift starting ${formatPunchTime(exInParsed)}`
        : `a shift from ${formatPunchTime(exInParsed)} to ${formatPunchTime(new Date(exEnd))}`;
      return {
        ok: false,
        reason: `This punch overlaps ${exDescription} for the same employee. Shifts can't overlap.`,
      };
    }
  }

  return VALID;
}
