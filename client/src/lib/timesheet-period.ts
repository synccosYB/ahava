// Shared period presets for time-sheet searches (used by the Time Sheet Review
// page and the per-employee Review Time Sheet tab). "custom" uses calendar
// date pickers; the rest resolve to a concrete Thu–Wed-anchored or rolling range.
import { currentWeek, currentWorkPeriod, currentPayrollPeriod, shiftWeeks, type DateRange } from "@/lib/payroll-week";

export type Period =
  | "this_week"
  | "this_plus_last_week"
  | "work_period"
  | "payroll_period"
  | "past_week"
  | "past_month"
  | "past_3_months"
  | "this_year"
  | "last_12_months"
  | "custom";

export const PERIOD_LABELS: Record<Period, string> = {
  this_week: "This week",
  this_plus_last_week: "This + last week",
  // The two anchored bi-weekly pay periods (see payroll-week.ts): the work
  // period is the current, in-progress 2 weeks; the payroll period is the most
  // recently completed 2 weeks (the one being processed for pay).
  work_period: "Current work period (in progress)",
  payroll_period: "Current payroll period (to process)",
  past_week: "Past week",
  past_month: "Past month",
  past_3_months: "Past 3 months",
  this_year: "This year (since Jan 1)",
  last_12_months: "Last 12 months",
  custom: "Custom dates…",
};

export const PERIOD_KEYS = Object.keys(PERIOD_LABELS) as Period[];

export function isPeriod(v: unknown): v is Period {
  return typeof v === "string" && (PERIOD_LABELS as Record<string, string>)[v] !== undefined;
}

// Legacy saved-preference migration: the old single "pay_period" preset (a
// rolling "this + last week") is now the anchored "payroll period". Map it so a
// stored preference keeps working instead of silently falling back to a week.
export function normalizePeriod(v: unknown): Period {
  if (v === "pay_period") return "payroll_period";
  return isPeriod(v) ? v : "this_week";
}

/** Local-timezone YYYY-MM-DD (matches the user's calendar day, not UTC). */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ymdToDate(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Resolve a period preset (+ custom dates) to an actual date range. */
export function rangeForPeriod(period: Period, customStart = "", customEnd = ""): DateRange {
  const now = new Date();
  const end = ymdLocal(now);
  const back = (fn: (d: Date) => void): DateRange => {
    const d = new Date(now);
    fn(d);
    return { start: ymdLocal(d), end };
  };
  switch (period) {
    case "this_week":
      return currentWeek();
    case "this_plus_last_week": {
      const w = currentWeek();
      return { start: shiftWeeks(w, -1).start, end: w.end };
    }
    case "work_period":
      return currentWorkPeriod();
    case "payroll_period":
      return currentPayrollPeriod();
    case "past_week":
      return back((d) => d.setDate(d.getDate() - 7));
    case "past_month":
      return back((d) => d.setMonth(d.getMonth() - 1));
    case "past_3_months":
      return back((d) => d.setMonth(d.getMonth() - 3));
    case "this_year":
      return { start: `${now.getFullYear()}-01-01`, end };
    case "last_12_months":
      return back((d) => d.setFullYear(d.getFullYear() - 1));
    case "custom":
      return { start: customStart || end, end: customEnd || customStart || end };
  }
}
