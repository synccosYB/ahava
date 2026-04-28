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
 * shift crosses midnight, returns the local end date (YYYY-MM-DD) and a
 * formatted end time suitable for display in a tooltip.
 */
export function getOvernightShiftInfo(
  workDate: string | null | undefined,
  clockOut: string | Date | null | undefined,
): { endDate: string; endTime: string } | null {
  if (!workDate || !clockOut) return null;
  const out = clockOut instanceof Date ? clockOut : new Date(clockOut);
  if (isNaN(out.getTime())) return null;
  const yyyy = out.getFullYear();
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  const endDate = `${yyyy}-${mm}-${dd}`;
  if (endDate <= workDate) return null;
  const endTime = out.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { endDate, endTime };
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
