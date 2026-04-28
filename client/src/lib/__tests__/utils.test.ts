import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liveElapsedSeconds,
  addLiveElapsedHours,
  formatHoursMinutes,
  formatTime12,
  formatTime12FromHHmm,
  formatDate,
  formatDateRange,
} from "../utils";

test("liveElapsedSeconds returns 0 for null clock-in", () => {
  assert.equal(liveElapsedSeconds(null, 1_000_000), 0);
});

test("liveElapsedSeconds advances over time", () => {
  const clockIn = new Date("2026-04-21T12:07:00Z");
  const tNow = clockIn.getTime() + 65_000; // 1m 5s later
  assert.equal(liveElapsedSeconds(clockIn, tNow), 65);

  const tLater = clockIn.getTime() + 66_000;
  assert.equal(liveElapsedSeconds(clockIn, tLater), 66);
});

test("liveElapsedSeconds clamps to 0 if now is before clock-in", () => {
  const clockIn = new Date("2026-04-21T12:07:00Z");
  assert.equal(liveElapsedSeconds(clockIn, clockIn.getTime() - 5_000), 0);
});

test("addLiveElapsedHours grows by elapsed delta in hours", () => {
  const fetched = 1_000_000_000_000;
  const oneMinLater = fetched + 60 * 1000;
  const result = addLiveElapsedHours(2.0, fetched, oneMinLater);
  assert.equal(Math.round(result * 60), 121); // 2h0m + 1m = 2h1m
});

test("addLiveElapsedHours falls back to base when fetchedAt missing", () => {
  assert.equal(addLiveElapsedHours(1.5, undefined, Date.now()), 1.5);
});

test("formatHoursMinutes ticks at minute granularity for live values", () => {
  assert.equal(formatHoursMinutes(2 + 0 / 60), "2h 0m");
  assert.equal(formatHoursMinutes(2 + 1 / 60), "2h 1m");
});

test("formatTime12 renders Date in 12-hour format with AM/PM", () => {
  // Construct dates in local time so output is locale-independent in tests.
  const morning = new Date(2026, 3, 21, 9, 0, 0);
  assert.equal(formatTime12(morning), "9:00 AM");

  const afternoon = new Date(2026, 3, 21, 13, 42, 0);
  assert.equal(formatTime12(afternoon), "1:42 PM");

  const noon = new Date(2026, 3, 21, 12, 5, 0);
  assert.equal(formatTime12(noon), "12:05 PM");

  const midnight = new Date(2026, 3, 21, 0, 0, 0);
  assert.equal(formatTime12(midnight), "12:00 AM");
});

test("formatTime12 returns empty string for missing/invalid input", () => {
  assert.equal(formatTime12(null), "");
  assert.equal(formatTime12(undefined), "");
  assert.equal(formatTime12(""), "");
  assert.equal(formatTime12("not-a-date"), "");
});

test("formatTime12FromHHmm converts 24-hour HH:mm strings to 12-hour", () => {
  assert.equal(formatTime12FromHHmm("13:42"), "1:42 PM");
  assert.equal(formatTime12FromHHmm("09:00"), "9:00 AM");
  assert.equal(formatTime12FromHHmm("00:00"), "12:00 AM");
  assert.equal(formatTime12FromHHmm("12:00"), "12:00 PM");
  assert.equal(formatTime12FromHHmm("23:05"), "11:05 PM");
  assert.equal(formatTime12FromHHmm("7:30"), "7:30 AM");
});

test("formatTime12FromHHmm handles missing/invalid input", () => {
  assert.equal(formatTime12FromHHmm(null), "");
  assert.equal(formatTime12FromHHmm(undefined), "");
  assert.equal(formatTime12FromHHmm(""), "");
  assert.equal(formatTime12FromHHmm("garbage"), "garbage");
  assert.equal(formatTime12FromHHmm("25:00"), "25:00");
});

test("formatDate returns empty string for null/undefined/empty/invalid input", () => {
  assert.equal(formatDate(null), "");
  assert.equal(formatDate(undefined), "");
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("not a date"), "");
});

test("formatDate parses plain YYYY-MM-DD as a local calendar date", () => {
  // Should always render as 04/21/2026 regardless of TZ (no UTC shift).
  assert.equal(formatDate("2026-04-21"), "04/21/2026");
  assert.equal(formatDate("2026-01-05"), "01/05/2026");
});

test("formatDate zero-pads month and day from Date instances", () => {
  assert.equal(formatDate(new Date(2026, 0, 5)), "01/05/2026");
  assert.equal(formatDate(new Date(2026, 11, 9)), "12/09/2026");
});

test("formatDate formats Date instances and ISO timestamps", () => {
  assert.equal(formatDate(new Date(2026, 3, 21)), "04/21/2026");
  // ISO timestamp at noon local — same calendar day everywhere reasonable.
  const noonLocal = new Date(2026, 3, 21, 12, 0, 0);
  assert.equal(formatDate(noonLocal.toISOString()), "04/21/2026");
});

test("formatDateRange collapses identical dates and joins distinct ones", () => {
  assert.equal(formatDateRange("2026-04-21", "2026-04-21"), "04/21/2026");
  assert.equal(
    formatDateRange("2026-04-21", "2026-04-23"),
    "04/21/2026 – 04/23/2026",
  );
});

test("formatDateRange handles single-sided and empty input", () => {
  assert.equal(formatDateRange("2026-04-21", null), "04/21/2026");
  assert.equal(formatDateRange(null, "2026-04-21"), "04/21/2026");
  assert.equal(formatDateRange(null, null), "");
});
