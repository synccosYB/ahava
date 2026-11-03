/**
 * The ADMS options handshake must tell the clock the Eastern offset (not UTC),
 * so the device face shows local time. No DB needed.
 *
 * Run with: `tsx server/adms/__tests__/optionsTimezone.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptionsResponse, tzOffsetMinutes } from "../protocol";

test("Eastern offset follows daylight-saving (minutes, negative west of GMT)", () => {
  assert.equal(tzOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z")), -300); // EST
  assert.equal(tzOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z")), -240); // EDT
  assert.equal(tzOffsetMinutes("UTC"), 0);
});

test("options response sends the Eastern offset, never UTC (0)", () => {
  const out = buildOptionsResponse("TESTSN123");
  const line = out.split("\n").find((l) => l.startsWith("TimeZone="));
  assert.ok(line, "a TimeZone line is present");
  const mins = Number(line!.split("=")[1]);
  assert.ok(mins === -300 || mins === -240, `Eastern offset, got ${mins}`);
  assert.notEqual(mins, 0, "must not pin the clock to UTC");
});
