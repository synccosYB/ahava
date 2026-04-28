export const CORRECTION_COUNT_WINDOW_DAYS = 90;
export const HIGH_CORRECTION_THRESHOLD = 5;
export const CORRECTION_COUNT_TYPES = ["time_correction", "missing_punch"] as const;

export type CorrectionCountType = (typeof CORRECTION_COUNT_TYPES)[number];

export type CorrectionCountSummary = {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  windowDays: number;
  threshold: number;
};

export function emptyCorrectionCountSummary(): CorrectionCountSummary {
  return {
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
    windowDays: CORRECTION_COUNT_WINDOW_DAYS,
    threshold: HIGH_CORRECTION_THRESHOLD,
  };
}

export function isHighCorrectionCount(count: number | null | undefined): boolean {
  return typeof count === "number" && count >= HIGH_CORRECTION_THRESHOLD;
}
