import { test } from "node:test";
import assert from "node:assert/strict";
import { liveElapsedSeconds, addLiveElapsedHours, formatHoursMinutes } from "../utils";

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
