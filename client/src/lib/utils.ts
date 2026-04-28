import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a Date or ISO timestamp as a 12-hour time string with AM/PM
 * (e.g. "1:42 PM"). Locale-independent — always uses en-US 12-hour format.
 * Returns an empty string for missing/invalid input.
 */
export function formatTime12(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format an "HH:mm" 24-hour time string as a 12-hour time string with AM/PM
 * (e.g. "13:42" -> "1:42 PM"). Returns the input unchanged when it cannot be
 * parsed, and "" for missing input.
 */
export function formatTime12FromHHmm(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return hhmm;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return hhmm;
  }
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Format a date value as a zero-padded MM/DD/YYYY string for user-facing
 * display.
 *
 * Plain `YYYY-MM-DD` strings are treated as local calendar dates (no timezone
 * shift) so a value like "2026-04-21" always renders as "04/21/2026"
 * regardless of the viewer's timezone. ISO timestamps and `Date` instances are
 * formatted in the local timezone. Returns "" for null, undefined, empty, or
 * unparseable input — callers that want a placeholder can do
 * `formatDate(value) || "—"`.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";

  let year: number;
  let month: number;
  let day: number;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else if (typeof value === "string") {
    const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (plain) {
      year = Number(plain[1]);
      month = Number(plain[2]);
      day = Number(plain[3]);
    } else {
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
    }
  } else {
    return "";
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${mm}/${dd}/${year}`;
}

/**
 * Format an inclusive date range using {@link formatDate}. When start and end
 * resolve to the same day a single date is returned. When only one side is
 * present, that single date is returned. Returns "" when both sides are
 * empty/invalid.
 */
export function formatDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e) {
    if (s === e) return s;
    return `${s} – ${e}`;
  }
  return s || e;
}

export function formatHoursMinutes(decimalHours: number | null | undefined): string {
  if (decimalHours == null || decimalHours === 0) return "0h 0m";
  const totalMinutes = Math.round(decimalHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/**
 * Compute the live elapsed seconds since a clock-in moment.
 * Returns 0 when input is missing or in the future.
 */
export function liveElapsedSeconds(
  clockInIso: string | Date | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!clockInIso) return 0;
  const start = clockInIso instanceof Date ? clockInIso.getTime() : new Date(clockInIso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

/**
 * Determine whether a shift's clock-out timestamp falls on a calendar day
 * later than the shift's work date (in the viewer's local timezone). Returns
 * `null` for in-progress shifts, missing input, or same-day shifts. When the
 * shift crosses midnight, returns the local end date (YYYY-MM-DD), a
 * formatted end time, a compact human end-date label (e.g. "Apr 28"), and
 * the number of full calendar days between the work date and the end date.
 */
export function getOvernightShiftInfo(
  workDate: string | null | undefined,
  clockOut: string | Date | null | undefined,
): { endDate: string; endTime: string; endDateLabel: string; daysSpan: number } | null {
  if (!workDate || !clockOut) return null;
  const out = clockOut instanceof Date ? clockOut : new Date(clockOut);
  if (isNaN(out.getTime())) return null;
  const yyyy = out.getFullYear();
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  const endDate = `${yyyy}-${mm}-${dd}`;
  if (endDate <= workDate) return null;
  const endTime = formatTime12(out);
  const [wy, wmo, wda] = workDate.split("-").map(Number);
  let daysSpan = 1;
  let endDateLabel = endDate;
  if (Number.isFinite(wy) && Number.isFinite(wmo) && Number.isFinite(wda)) {
    const startLocal = new Date(wy, wmo - 1, wda);
    const endLocal = new Date(yyyy, out.getMonth(), out.getDate());
    daysSpan = Math.max(
      1,
      Math.round((endLocal.getTime() - startLocal.getTime()) / 86_400_000),
    );
    endDateLabel = endLocal.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return { endDate, endTime, endDateLabel, daysSpan };
}

/**
 * Add the time elapsed since the server values were fetched to a base hours
 * count. Used to make the "Today"/"This Week" totals tick on the client
 * between server refetches without double-counting.
 */
export function addLiveElapsedHours(
  baseHours: number | null | undefined,
  fetchedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  const base = baseHours ?? 0;
  if (!fetchedAtMs || !Number.isFinite(fetchedAtMs)) return base;
  const deltaMs = Math.max(0, nowMs - fetchedAtMs);
  return base + deltaMs / 3_600_000;
}
