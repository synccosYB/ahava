/**
 * Regression coverage for the punch-time display timezone contract: punch times
 * are stored in UTC but must always render in the clinic's wall-clock time
 * (location → company → "America/New_York"), NEVER the viewer's browser
 * timezone. See `.agents/memory/punch-time-display-tz.md`.
 *
 * These pin the three load-bearing helpers so a future change can't silently
 * revert displays to the viewer's local timezone:
 *   - formatTime12InTz (client/src/lib/utils.ts) — wall-clock formatting in a
 *     supplied IANA tz, with graceful fallback to local time.
 *   - getOvernightShiftInfo (client/src/lib/utils.ts) — overnight detection +
 *     end-date label computed in the supplied tz.
 *   - resolveEmployeeTimezone (server/services/punchOverlap.ts) — the
 *     location → company → default resolution order.
 *
 * Run with: `npx tsx server/__tests__/punchTimeDisplayTz.test.ts`
 * (no DATABASE_URL required — storage is stubbed for the server fn).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTime12InTz,
  formatTime12,
  getOvernightShiftInfo,
} from "../../client/src/lib/utils";
import { resolveEmployeeTimezone } from "../services/punchOverlap";
import { localTimeParts, formatScheduleWarning } from "../scheduleWarning";
import { storage } from "../storage";

// --- formatTime12InTz ------------------------------------------------------

test("formatTime12InTz: renders wall-clock for a non-local IANA tz", () => {
  // 18:30 UTC is an unambiguous instant; assert each zone's wall-clock time
  // regardless of the machine's local timezone the test runs on.
  const at = new Date(Date.UTC(2025, 0, 15, 18, 30, 0));
  assert.equal(formatTime12InTz(at, "America/New_York"), "1:30 PM"); // UTC-5 (Jan)
  assert.equal(formatTime12InTz(at, "America/Los_Angeles"), "10:30 AM"); // UTC-8
  assert.equal(formatTime12InTz(at, "Asia/Tokyo"), "3:30 AM"); // UTC+9 (next day)
  assert.equal(formatTime12InTz(at, "UTC"), "6:30 PM");
});

test("formatTime12InTz: accepts an ISO string the same as a Date", () => {
  const iso = "2025-07-15T18:30:00.000Z"; // summer → NY is UTC-4
  assert.equal(formatTime12InTz(iso, "America/New_York"), "2:30 PM");
});

test("formatTime12InTz: falls back to local time when tz is null", () => {
  const at = new Date(Date.UTC(2025, 0, 15, 18, 30, 0));
  assert.equal(formatTime12InTz(at, null), formatTime12(at));
  assert.equal(formatTime12InTz(at, undefined), formatTime12(at));
});

test("formatTime12InTz: falls back to local time on an invalid tz (no throw)", () => {
  const at = new Date(Date.UTC(2025, 0, 15, 18, 30, 0));
  assert.equal(formatTime12InTz(at, "Not/AReal_Zone"), formatTime12(at));
});

test("formatTime12InTz: returns '' for missing/invalid input", () => {
  assert.equal(formatTime12InTz(null, "America/New_York"), "");
  assert.equal(formatTime12InTz(undefined, "America/New_York"), "");
  assert.equal(formatTime12InTz("not-a-date", "America/New_York"), "");
});

// --- getOvernightShiftInfo -------------------------------------------------

test("getOvernightShiftInfo: overnight in one tz but same-day in another", () => {
  // 02:00 UTC on Jan 16 for a shift whose work date is Jan 15.
  const workDate = "2025-01-15";
  const clockOut = new Date(Date.UTC(2025, 0, 16, 2, 0, 0));

  // Tokyo (UTC+9): Jan 16 11:00 → end day is AFTER the work date → overnight.
  const tokyo = getOvernightShiftInfo(workDate, clockOut, "Asia/Tokyo");
  assert.ok(tokyo, "expected an overnight result in Asia/Tokyo");
  assert.equal(tokyo!.endDate, "2025-01-16");
  assert.equal(tokyo!.endTime, "11:00 AM");
  assert.equal(tokyo!.daysSpan, 1);

  // New York (UTC-5): Jan 15 21:00 → still the work date → NOT overnight.
  const ny = getOvernightShiftInfo(workDate, clockOut, "America/New_York");
  assert.equal(ny, null);
});

test("getOvernightShiftInfo: overnight in clinic tz but same-day in a westward tz", () => {
  // 06:00 UTC on Jan 16 for a shift whose work date is Jan 15.
  const workDate = "2025-01-15";
  const clockOut = new Date(Date.UTC(2025, 0, 16, 6, 0, 0));

  // New York (UTC-5): Jan 16 01:00 → overnight.
  const ny = getOvernightShiftInfo(workDate, clockOut, "America/New_York");
  assert.ok(ny, "expected an overnight result in America/New_York");
  assert.equal(ny!.endDate, "2025-01-16");
  assert.equal(ny!.endTime, "1:00 AM");

  // Honolulu (UTC-10): Jan 15 20:00 → still the work date → NOT overnight.
  const hawaii = getOvernightShiftInfo(workDate, clockOut, "Pacific/Honolulu");
  assert.equal(hawaii, null);
});

test("getOvernightShiftInfo: computes daysSpan across multiple days in tz", () => {
  const workDate = "2025-01-15";
  const clockOut = new Date(Date.UTC(2025, 0, 17, 14, 0, 0)); // Jan 17 in NY
  const info = getOvernightShiftInfo(workDate, clockOut, "America/New_York");
  assert.ok(info);
  assert.equal(info!.endDate, "2025-01-17");
  assert.equal(info!.daysSpan, 2);
});

test("getOvernightShiftInfo: returns null for in-progress/missing input", () => {
  assert.equal(getOvernightShiftInfo("2025-01-15", null, "UTC"), null);
  assert.equal(getOvernightShiftInfo(null, new Date(), "UTC"), null);
  assert.equal(
    getOvernightShiftInfo("2025-01-15", "not-a-date", "UTC"),
    null,
  );
});

test("getOvernightShiftInfo: invalid tz still resolves without throwing", () => {
  // Falls back to local calendar components; just assert it doesn't throw and
  // returns the expected null/non-null shape (no tz-dependent assertions).
  const result = getOvernightShiftInfo(
    "2025-01-15",
    new Date(Date.UTC(2025, 0, 16, 12, 0, 0)),
    "Not/AReal_Zone",
  );
  assert.ok(result === null || typeof result.endDate === "string");
});

// --- resolveEmployeeTimezone ----------------------------------------------

const DEFAULT_TIMEZONE = "America/New_York";

function withStubbedStorage(
  stubs: {
    locationIds?: string[];
    locations?: Record<string, any>;
    companies?: Record<string, any>;
    locationIdsThrows?: boolean;
  },
  body: () => Promise<void>,
): Promise<void> {
  const orig = {
    getUserLocationIds: storage.getUserLocationIds,
    getLocation: storage.getLocation,
    getCompany: storage.getCompany,
  };
  (storage as any).getUserLocationIds = async () => {
    if (stubs.locationIdsThrows) throw new Error("boom");
    return stubs.locationIds ?? [];
  };
  (storage as any).getLocation = async (id: string) =>
    (stubs.locations ?? {})[id];
  (storage as any).getCompany = async (id: string) =>
    (stubs.companies ?? {})[id];
  return body().finally(() => {
    (storage as any).getUserLocationIds = orig.getUserLocationIds;
    (storage as any).getLocation = orig.getLocation;
    (storage as any).getCompany = orig.getCompany;
  });
}

test("resolveEmployeeTimezone: prefers the location timezone", async () => {
  await withStubbedStorage(
    {
      locationIds: ["loc1"],
      locations: {
        loc1: { id: "loc1", timezone: "America/Chicago", companyId: "co1" },
      },
      companies: { co1: { id: "co1", timezone: "America/Denver" } },
    },
    async () => {
      assert.equal(await resolveEmployeeTimezone("u1"), "America/Chicago");
    },
  );
});

test("resolveEmployeeTimezone: falls back to company timezone when location has none", async () => {
  await withStubbedStorage(
    {
      locationIds: ["loc1"],
      locations: {
        loc1: { id: "loc1", timezone: null, companyId: "co1" },
      },
      companies: { co1: { id: "co1", timezone: "America/Denver" } },
    },
    async () => {
      assert.equal(await resolveEmployeeTimezone("u1"), "America/Denver");
    },
  );
});

test("resolveEmployeeTimezone: falls back to default when nothing resolves", async () => {
  await withStubbedStorage(
    {
      locationIds: ["loc1"],
      locations: { loc1: { id: "loc1", timezone: null, companyId: null } },
    },
    async () => {
      assert.equal(await resolveEmployeeTimezone("u1"), DEFAULT_TIMEZONE);
    },
  );
});

test("resolveEmployeeTimezone: default when employee has no locations", async () => {
  await withStubbedStorage({ locationIds: [] }, async () => {
    assert.equal(await resolveEmployeeTimezone("u1"), DEFAULT_TIMEZONE);
  });
});

test("resolveEmployeeTimezone: never throws — default on lookup failure", async () => {
  await withStubbedStorage({ locationIdsThrows: true }, async () => {
    assert.equal(await resolveEmployeeTimezone("u1"), DEFAULT_TIMEZONE);
  });
});

// --- Kiosk activity feed row formatting -----------------------------------
// The Kiosk Management "Recent activity" feed renders each punch's time using
// formatTime12InTz with the server-stamped per-employee timezone, so a remote
// admin sees the clinic's wall-clock time, not their own browser time.
test("kiosk activity row: renders the punch instant in the stamped clinic tz", () => {
  const punch = {
    timestamp: "2025-07-15T18:30:00.000Z", // summer → NY is UTC-4
    workDate: "2025-07-15",
    timezone: "America/New_York",
  };
  assert.equal(formatTime12InTz(punch.timestamp, punch.timezone), "2:30 PM");
});

test("kiosk activity row: null timezone falls back to local (never blank/crash)", () => {
  const at = new Date(Date.UTC(2025, 0, 15, 18, 30, 0));
  assert.equal(formatTime12InTz(at.toISOString(), null), formatTime12(at));
});

// --- Static guards: punch-time surfaces must not raw-render local time ------
// These read the actual source so a future edit that reintroduces a raw
// browser-local render of a punch time fails loudly here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __here = dirname(fileURLToPath(import.meta.url));
const clientPage = (rel: string) =>
  readFileSync(resolve(__here, "../../client/src/pages", rel), "utf8");

test("kiosk-management page formats activity times via formatTime12InTz", () => {
  const src = clientPage("kiosk-management.tsx");
  assert.match(
    src,
    /formatTime12InTz\(\s*p\.timestamp\s*,\s*p\.timezone\s*\)/,
    "kiosk activity time cell must use formatTime12InTz(p.timestamp, p.timezone)",
  );
  assert.ok(
    !/new Date\(p\.timestamp\)\.toLocaleString\(\)/.test(src),
    "kiosk activity punch time must not use raw new Date(p.timestamp).toLocaleString()",
  );
});

test("reconciliation page has no raw-local punch datetime formatter", () => {
  const src = clientPage("reconciliation.tsx");
  assert.ok(
    !/function fmtDateTime\b/.test(src),
    "the dead raw-local fmtDateTime formatter must stay removed from reconciliation",
  );
});

// --- Schedule late/early warning timezone (Task #507) ----------------------
// The clock-in/out "You are X hours and Y minutes late/early" warning must be
// measured against the employee's business/location wall-clock time, NOT the
// server's local time (UTC here). Schedule start/end are stored as local
// wall-clock strings, so once "now" is rendered in the same tz the minute math
// is unchanged. These pin the two load-bearing helpers so a future change can't
// silently revert to server-local time (which inflated "late" by the tz offset).

test("localTimeParts: renders wall-clock hour/minute/day in a non-UTC tz", () => {
  // 15:09 UTC on Wed Jan 15 2025.
  const at = new Date(Date.UTC(2025, 0, 15, 15, 9, 0));
  // New York (UTC-5 in Jan): 10:09 AM, still Wednesday.
  const ny = localTimeParts(at, "America/New_York");
  assert.equal(ny.minutes, 10 * 60 + 9);
  assert.equal(ny.dayOfWeek, 3);
  // UTC: 15:09, Wednesday.
  const utc = localTimeParts(at, "UTC");
  assert.equal(utc.minutes, 15 * 60 + 9);
  assert.equal(utc.dayOfWeek, 3);
});

test("localTimeParts: near-midnight punch selects the correct local day", () => {
  // 02:30 UTC on Thu Jan 16 2025.
  const at = new Date(Date.UTC(2025, 0, 16, 2, 30, 0));
  // New York (UTC-5): Wed Jan 15 21:30 → day should still be Wednesday (3).
  const ny = localTimeParts(at, "America/New_York");
  assert.equal(ny.dayOfWeek, 3);
  assert.equal(ny.minutes, 21 * 60 + 30);
  // Tokyo (UTC+9): Thu Jan 16 11:30 → Thursday (4).
  const tokyo = localTimeParts(at, "Asia/Tokyo");
  assert.equal(tokyo.dayOfWeek, 4);
  assert.equal(tokyo.minutes, 11 * 60 + 30);
});

test("localTimeParts: falls back to server-local components on invalid tz", () => {
  const at = new Date(Date.UTC(2025, 0, 15, 15, 9, 0));
  const bogus = localTimeParts(at, "Not/AReal_Zone");
  assert.equal(bogus.dayOfWeek, at.getDay());
  assert.equal(bogus.minutes, at.getHours() * 60 + at.getMinutes());
});

test("schedule warning: lateness is the employee's LOCAL gap, not the UTC gap", () => {
  // The bug: clocking in at 11:09 AM Eastern against a 09:00 shift is 2h9m late,
  // but server-local (UTC) time read 15:09 → 6h9m late. Simulate by computing
  // the local minutes from a fixed UTC instant, then formatting.
  const at = new Date(Date.UTC(2025, 6, 15, 15, 9, 0)); // 15:09 UTC (summer → NY UTC-4 → 11:09 AM)
  const { minutes } = localTimeParts(at, "America/New_York");
  assert.equal(minutes, 11 * 60 + 9);
  const warning = formatScheduleWarning("clock_in", minutes, {
    startTime: "09:00",
    endTime: "17:00",
  });
  assert.equal(warning, "You are 2 hours and 9 minutes late");
  // Guard against the regression: server-local (UTC) minutes would say 6h9m.
  const utcMinutes = localTimeParts(at, "UTC").minutes;
  const wrong = formatScheduleWarning("clock_in", utcMinutes, {
    startTime: "09:00",
    endTime: "17:00",
  });
  assert.equal(wrong, "You are 6 hours and 9 minutes late");
  assert.notEqual(warning, wrong);
});

test("schedule warning: clock-out 'leaving early' uses local time basis", () => {
  const at = new Date(Date.UTC(2025, 6, 15, 20, 30, 0)); // 20:30 UTC → 4:30 PM NY (UTC-4)
  const { minutes } = localTimeParts(at, "America/New_York");
  const warning = formatScheduleWarning("clock_out", minutes, {
    startTime: "09:00",
    endTime: "17:00",
  });
  assert.equal(warning, "You are leaving 30 minutes early");
});

test("schedule warning: exactly on time returns null", () => {
  const on = formatScheduleWarning("clock_in", 9 * 60, {
    startTime: "09:00",
    endTime: "17:00",
  });
  assert.equal(on, null);
});

test("schedule warning source: getScheduleWarning derives now in the employee tz", () => {
  const src = readFileSync(resolve(__here, "../routes.ts"), "utf8");
  // Must resolve the employee timezone and use localTimeParts, not raw getHours/getDay.
  assert.match(
    src,
    /localTimeParts\(now,\s*timezone\)/,
    "getScheduleWarning must compute now via localTimeParts(now, timezone)",
  );
  const fnStart = src.indexOf("async function getScheduleWarning");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.ok(
    !/now\.getHours\(\)|now\.getMinutes\(\)|now\.getDay\(\)/.test(fnBody),
    "getScheduleWarning must not read server-local now.getHours/getMinutes/getDay",
  );
});
