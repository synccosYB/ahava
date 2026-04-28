export const CORRECTION_COUNT_WINDOW_DAYS = 90;
export const HIGH_CORRECTION_THRESHOLD = 5;
export const CORRECTION_COUNT_TYPES = ["time_correction", "missing_punch"] as const;

export type CorrectionCountType = (typeof CORRECTION_COUNT_TYPES)[number];

export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const DEFAULT_PAY_PERIOD_TYPE: PayPeriodType = "biweekly";

export type CorrectionCountBucket = {
  total: number;
  pending: number;
  approved: number;
  denied: number;
};

export type CorrectionCountBucketKey =
  | "payPeriod"
  | "week"
  | "month"
  | "year"
  | "all";

export type CorrectionCountSummary = {
  payPeriod: CorrectionCountBucket;
  week: CorrectionCountBucket;
  month: CorrectionCountBucket;
  year: CorrectionCountBucket;
  all: CorrectionCountBucket;
  threshold: number;
  // Legacy 90-day window fields kept for backwards compatibility with
  // existing in-flight callers (e.g. the employee-facing my-attendance copy).
  windowDays: number;
  total: number;
  pending: number;
  approved: number;
  denied: number;
};

export function emptyCorrectionCountBucket(): CorrectionCountBucket {
  return { total: 0, pending: 0, approved: 0, denied: 0 };
}

export function emptyCorrectionCountSummary(): CorrectionCountSummary {
  return {
    payPeriod: emptyCorrectionCountBucket(),
    week: emptyCorrectionCountBucket(),
    month: emptyCorrectionCountBucket(),
    year: emptyCorrectionCountBucket(),
    all: emptyCorrectionCountBucket(),
    threshold: HIGH_CORRECTION_THRESHOLD,
    windowDays: CORRECTION_COUNT_WINDOW_DAYS,
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
  };
}

export function isHighCorrectionCount(count: number | null | undefined): boolean {
  return typeof count === "number" && count >= HIGH_CORRECTION_THRESHOLD;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Monday-anchored week start (ISO week).
export function getCurrentWeekStart(now: Date = new Date()): Date {
  const d = startOfDay(now);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const offset = (day + 6) % 7; // 0 if Monday
  d.setDate(d.getDate() - offset);
  return d;
}

export function getCurrentMonthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function getCurrentYearStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), 0, 1);
}

// Anchor: 2024-01-01 was a Monday — used as the biweekly reference origin.
const BIWEEKLY_ANCHOR = new Date(2024, 0, 1);

export function getCurrentPayPeriodStart(
  type: PayPeriodType | string | null | undefined,
  now: Date = new Date()
): Date {
  const normalized: PayPeriodType =
    type === "weekly" ||
    type === "biweekly" ||
    type === "semimonthly" ||
    type === "monthly"
      ? type
      : DEFAULT_PAY_PERIOD_TYPE;

  const today = startOfDay(now);
  switch (normalized) {
    case "weekly":
      return getCurrentWeekStart(today);
    case "biweekly": {
      const diffDays = Math.floor(
        (today.getTime() - BIWEEKLY_ANCHOR.getTime()) / 86400000
      );
      const periodIndex = Math.floor(diffDays / 14);
      const start = new Date(BIWEEKLY_ANCHOR);
      start.setDate(BIWEEKLY_ANCHOR.getDate() + periodIndex * 14);
      return start;
    }
    case "semimonthly": {
      const day = today.getDate();
      const month = today.getMonth();
      const year = today.getFullYear();
      return new Date(year, month, day <= 15 ? 1 : 16);
    }
    case "monthly":
      return new Date(today.getFullYear(), today.getMonth(), 1);
  }
}

export function payPeriodLabel(type: PayPeriodType | string | null | undefined): string {
  switch (type) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Biweekly";
    case "semimonthly":
      return "Semi-Monthly";
    case "monthly":
      return "Monthly";
    default:
      return "Biweekly";
  }
}
