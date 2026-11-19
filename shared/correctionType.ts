/**
 * Maps an employee's explicit punch-correction choice to the stored exception
 * `type`. The employee picks, with no auto-detection:
 *   - requestType: are they adding a punch that's MISSING, or FIXING the time on
 *     a punch that's already recorded?
 *   - side: is it the Clock IN or the Clock OUT?
 * One side per request (a whole missing day is two requests).
 *
 * The four resulting types already exist and are applied by the resolve
 * endpoint:
 *   - time_correction     — update one side's time on an existing punch
 *   - forgotten_clock_in  — add the missing IN to a punch (or open a new one)
 *   - forgotten_clock_out — add the missing OUT to an open punch
 *   - missing_punch       — no punch exists at all; insert one
 */
export type CorrectionRequestType = "missing" | "fix";
export type CorrectionSide = "in" | "out";
export type CorrectionExceptionType =
  | "missing_punch"
  | "forgotten_clock_in"
  | "forgotten_clock_out"
  | "time_correction";

export function classifyCorrection(opts: {
  requestType: CorrectionRequestType;
  side: CorrectionSide;
  hasExistingPunch: boolean;
}): CorrectionExceptionType {
  // Fixing the time on a punch that's already there is always a one-sided
  // time correction (the chosen side carries the corrected time).
  if (opts.requestType === "fix") return "time_correction";
  // Adding a missing punch:
  //  - no punch at all for the date -> insert a new one (missing_punch);
  //  - an existing punch is missing its OUT -> close it (forgotten_clock_out);
  //  - an existing punch is missing its IN  -> set the in on that punch via a
  //    one-sided time_correction. (Updating the existing punch avoids inserting
  //    a duplicate, which a forgotten_clock_in INSERT would risk.)
  if (!opts.hasExistingPunch) return "missing_punch";
  return opts.side === "out" ? "forgotten_clock_out" : "time_correction";
}

/** The human label for the single time field, given the choice. */
export function correctionTimeLabel(requestType: CorrectionRequestType, side: CorrectionSide): string {
  const which = side === "in" ? "Clock In" : "Clock Out";
  return requestType === "missing"
    ? `${which} time (what it should have been)`
    : `Corrected ${which} time`;
}
