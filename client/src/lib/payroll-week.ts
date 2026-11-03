/**
 * Ahava payroll week = Thursday → Wednesday. Thursday is day 1 of the week
 * (matches server workweekStartDay = 4). These helpers compute week/bi-week
 * ranges for the Review Time Sheet tab and the Reports period picker so the
 * client and server agree on boundaries.
 *
 * All values are date-only (YYYY-MM-DD, local calendar) — no timezone math,
 * because punches are stored/queried by local workDate.
 */
import { startOfWeek, addDays, addWeeks, format, parseISO } from "date-fns";

/** 0=Sun … 4=Thu … 6=Sat. Keep in sync with server DEFAULT_ATTENDANCE_RULES. */
export const PAYROLL_WEEK_STARTS_ON = 4; // Thursday

export interface DateRange {
  /** YYYY-MM-DD, inclusive */
  start: string;
  /** YYYY-MM-DD, inclusive */
  end: string;
}

function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** The Thursday that starts the payroll week containing `date` (default: today). */
export function payrollWeekStart(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: PAYROLL_WEEK_STARTS_ON });
}

/** The Thu–Wed range of the payroll week containing `date`. */
export function payrollWeekRange(date: Date = new Date()): DateRange {
  const start = payrollWeekStart(date);
  return { start: toISO(start), end: toISO(addDays(start, 6)) };
}

/** Shift a payroll-week range by `n` weeks (negative = earlier). */
export function shiftWeeks(range: DateRange, n: number): DateRange {
  const start = addWeeks(parseISO(range.start), n);
  return { start: toISO(start), end: toISO(addDays(start, 6)) };
}

/** A bi-weekly range: the two payroll weeks ending with the week of `date`
 * (i.e. the prior week + the week containing `date`). */
export function biWeeklyRange(date: Date = new Date()): DateRange {
  const thisWeek = payrollWeekRange(date);
  const prev = shiftWeeks(thisWeek, -1);
  return { start: prev.start, end: thisWeek.end };
}

/** The current (in-progress) payroll week. */
export function currentWeek(): DateRange {
  return payrollWeekRange(new Date());
}

/** The current bi-weekly period (this week + last week). */
export function currentBiWeek(): DateRange {
  return biWeeklyRange(new Date());
}

/** The last `n` COMPLETED payroll weeks (most recent first) — i.e. weeks that
 * ended before the current in-progress week. */
export function lastCompletedWeeks(n: number): DateRange[] {
  const current = currentWeek();
  const out: DateRange[] = [];
  for (let i = 1; i <= n; i++) out.push(shiftWeeks(current, -i));
  return out;
}

/** The last `n` COMPLETED bi-weekly periods (most recent first), each two
 * payroll weeks, rolling back two weeks at a time from the last completed week. */
export function lastCompletedBiWeeks(n: number): DateRange[] {
  const current = currentWeek();
  const out: DateRange[] = [];
  for (let i = 0; i < n; i++) {
    const end = shiftWeeks(current, -(1 + i * 2)); // most recent completed week, then back 2 each time
    const start = shiftWeeks(end, -1);
    out.push({ start: start.start, end: end.end });
  }
  return out;
}

/** Human label like "Oct 29 – Nov 4, 2026". */
export function formatRangeLabel(range: DateRange): string {
  const s = parseISO(range.start);
  const e = parseISO(range.end);
  const sameYear = format(s, "yyyy") === format(e, "yyyy");
  const left = format(s, "MMM d");
  const right = format(e, sameYear ? "MMM d, yyyy" : "MMM d, yyyy");
  return `${left} – ${right}`;
}
