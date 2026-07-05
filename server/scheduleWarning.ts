// Task #507: the clock-in/out schedule warning ("You are X hours and Y minutes
// late/early", "leaving early / stayed past your shift") must be measured against
// the employee's BUSINESS/LOCATION wall-clock time, not the server's local time
// (UTC in this environment). Employee schedule start/end are stored as local
// wall-clock strings (e.g. "09:00"), so "now" has to be rendered in the same
// timezone before the minute-difference math — otherwise the UTC→business-tz
// offset is added straight into the "late" figure (e.g. 2h9m late shown as 6h9m).
//
// These are kept pure + free of heavy imports so they can be regression-tested
// without a database.

import { DEFAULT_TIMEZONE } from "@shared/timezone";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function computeLocalTimeParts(
  at: Date,
  timezone: string,
): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekday = get("weekday");
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some environments emit "24" for midnight
  const minute = Number(get("minute"));
  const dayOfWeek = weekday != null ? WEEKDAY_INDEX[weekday] : undefined;
  if (dayOfWeek == null || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("unparsable local time parts");
  }
  return { dayOfWeek, minutes: hour * 60 + minute };
}

/**
 * Derive the wall-clock day-of-week + minutes-since-midnight for an instant as
 * rendered in a specific IANA timezone. If the given timezone is invalid or
 * unparsable, it falls back to the safe default business zone
 * ({@link DEFAULT_TIMEZONE}) — and NEVER to the server's local (UTC) clock,
 * which would inflate the lateness figure by the UTC→business offset
 * (task #514). Never throws.
 */
export function localTimeParts(
  at: Date,
  timezone: string,
): { dayOfWeek: number; minutes: number } {
  try {
    return computeLocalTimeParts(at, timezone);
  } catch {
    // Invalid/unrecognized zone — degrade to the safe default, not server-local.
    try {
      return computeLocalTimeParts(at, DEFAULT_TIMEZONE);
    } catch {
      return {
        dayOfWeek: at.getDay(),
        minutes: at.getHours() * 60 + at.getMinutes(),
      };
    }
  }
}

/**
 * Pure formatter for the schedule punch warning. `currentMinutes` and the
 * schedule start/end must all be minutes-since-midnight in the SAME timezone
 * (the employee's business/location tz). Returns null when the punch is exactly
 * on time.
 */
export function formatScheduleWarning(
  punchType: "clock_in" | "clock_out",
  currentMinutes: number,
  schedule: { startTime: string; endTime: string },
): string | null {
  const [startH, startM] = schedule.startTime.split(":").map(Number);
  const [endH, endM] = schedule.endTime.split(":").map(Number);
  const scheduleStart = startH * 60 + startM;
  const scheduleEnd = endH * 60 + endM;

  if (punchType === "clock_in") {
    const diff = currentMinutes - scheduleStart;
    if (diff < 0) {
      const mins = Math.abs(diff);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `You are ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} early` : `You are ${m} minute${m !== 1 ? "s" : ""} early`;
    } else if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return h > 0 ? `You are ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} late` : `You are ${m} minute${m !== 1 ? "s" : ""} late`;
    }
  } else {
    const diff = currentMinutes - scheduleEnd;
    if (diff < 0) {
      const mins = Math.abs(diff);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `You are leaving ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} early` : `You are leaving ${m} minute${m !== 1 ? "s" : ""} early`;
    } else if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return h > 0 ? `You stayed ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} past your shift` : `You stayed ${m} minute${m !== 1 ? "s" : ""} past your shift`;
    }
  }
  return null;
}
