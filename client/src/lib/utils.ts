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
