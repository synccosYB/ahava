/**
 * Unit tests for parseDevicePunchTime (server/adms/protocol): a biometric clock
 * reports LOCAL wall-clock time; we must interpret it in the location timezone
 * and store the correct UTC instant — not treat the string as UTC (which would
 * be hours off) and not stamp the punch at server-arrival time.
 *
 * Pure function, no DB — always runs.
 * Run with: `npx tsx server/adms/__tests__/deviceTime.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDevicePunchTime } from "../protocol";

const NY = "America/New_York";

test("Eastern DAYLIGHT time (EDT, -04:00) → UTC", () => {
  // Oct 20 is EDT. 08:03 local = 12:03 UTC.
  const d = parseDevicePunchTime("2026-10-20 08:03:11", NY);
  assert.ok(d, "parsed");
  assert.equal(d!.toISOString(), "2026-10-20T12:03:11.000Z");
});

test("Eastern STANDARD time (EST, -05:00) → UTC", () => {
  // Nov 20 is EST. 08:03 local = 13:03 UTC.
  const d = parseDevicePunchTime("2026-11-20 08:03:11", NY);
  assert.ok(d, "parsed");
  assert.equal(d!.toISOString(), "2026-11-20T13:03:11.000Z");
});

test("seconds are optional and default to :00", () => {
  const d = parseDevicePunchTime("2026-11-20 08:03", NY);
  assert.ok(d, "parsed");
  assert.equal(d!.toISOString(), "2026-11-20T13:03:00.000Z");
});

test("accepts a 'T' separator too", () => {
  const d = parseDevicePunchTime("2026-11-20T08:03:00", NY);
  assert.ok(d, "parsed");
  assert.equal(d!.toISOString(), "2026-11-20T13:03:00.000Z");
});

test("a late evening Eastern punch keeps its own calendar day in UTC", () => {
  // 11:30 PM EST on Nov 20 is 04:30 UTC on Nov 21 — the instant is correct;
  // the local work-date bucketing (localWorkDate) keeps it on Nov 20.
  const d = parseDevicePunchTime("2026-11-20 23:30:00", NY);
  assert.ok(d, "parsed");
  assert.equal(d!.toISOString(), "2026-11-21T04:30:00.000Z");
});

test("unparseable strings return null (caller falls back to server now)", () => {
  assert.equal(parseDevicePunchTime("", NY), null);
  assert.equal(parseDevicePunchTime("not a date", NY), null);
  assert.equal(parseDevicePunchTime("2026-13-01 08:00:00", NY), null, "month 13");
  assert.equal(parseDevicePunchTime("2026-10-20 25:00:00", NY), null, "hour 25");
});
