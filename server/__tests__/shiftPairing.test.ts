/**
 * suggestShiftPairing infers the complete shift from the time(s) an employee
 * enters plus any punch already on that day. Pure — no DB.
 *
 * Run with: `npx tsx --test server/__tests__/shiftPairing.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestShiftPairing, type PairingSuggestion } from "../services/shiftPairing";

const ok = (r: ReturnType<typeof suggestShiftPairing>): PairingSuggestion => {
  assert.ok(!("error" in r), "error" in r ? (r as { error: string }).error : "");
  return r as PairingSuggestion;
};

test("Ayala case: a lone punch recorded as clock-in + entered earlier time → pair as one shift", () => {
  // System has 5:17 PM as an (open) clock-in; employee says they clocked IN at 9:12 AM.
  const r = ok(suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T09:12:00Z")],
    existingPunches: [{ id: "p1", clockIn: new Date("2026-11-16T17:17:00Z"), clockOut: null }],
    overnightAllowed: false,
  }));
  assert.equal(r.clockIn.toISOString(), "2026-11-16T09:12:00.000Z", "earlier time becomes the clock-in");
  assert.equal(r.clockOut.toISOString(), "2026-11-16T17:17:00.000Z", "the existing 5:17 is the clock-out");
  assert.equal(r.targetPunchId, "p1", "updates the existing punch, not a duplicate");
  assert.equal(r.action, "update");
  assert.equal(r.overnight, false);
});

test("lone clock-OUT + entered later... still pairs by time order (direction is inferred)", () => {
  const r = ok(suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T16:00:00Z")],
    existingPunches: [{ id: "p2", clockIn: null, clockOut: new Date("2026-11-16T08:00:00Z") }],
    overnightAllowed: false,
  }));
  assert.equal(r.clockIn.toISOString(), "2026-11-16T08:00:00.000Z");
  assert.equal(r.clockOut.toISOString(), "2026-11-16T16:00:00.000Z");
  assert.equal(r.targetPunchId, "p2");
});

test("fully-missed day: no punch + two entered times → create a new complete shift", () => {
  const r = ok(suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T17:00:00Z"), new Date("2026-11-16T09:00:00Z")],
    existingPunches: [],
    overnightAllowed: false,
  }));
  assert.equal(r.clockIn.toISOString(), "2026-11-16T09:00:00.000Z");
  assert.equal(r.clockOut.toISOString(), "2026-11-16T17:00:00.000Z");
  assert.equal(r.targetPunchId, null);
  assert.equal(r.action, "create");
});

test("overnight worker: an implausibly long same-day pair is read as crossing midnight", () => {
  // Clock-in 11 PM, employee enters a 2 AM clock-out time on the same date.
  const r = ok(suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T02:00:00Z")],
    existingPunches: [{ id: "n1", clockIn: new Date("2026-11-16T23:00:00Z"), clockOut: null }],
    overnightAllowed: true,
  }));
  assert.equal(r.overnight, true);
  assert.equal(r.clockIn.toISOString(), "2026-11-16T23:00:00.000Z", "evening is the clock-in");
  assert.equal(r.clockOut.toISOString(), "2026-11-17T02:00:00.000Z", "morning rolls to the next day");
  assert.ok((r.clockOut.getTime() - r.clockIn.getTime()) / 3_600_000 === 3, "a sane 3-hour shift");
});

test("same times for a NON-overnight worker stay same-day (flag gates the midnight read)", () => {
  const r = ok(suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T02:00:00Z")],
    existingPunches: [{ id: "x1", clockIn: new Date("2026-11-16T23:00:00Z"), clockOut: null }],
    overnightAllowed: false,
  }));
  assert.equal(r.overnight, false);
  assert.equal(r.clockIn.toISOString(), "2026-11-16T02:00:00.000Z");
  assert.equal(r.clockOut.toISOString(), "2026-11-16T23:00:00.000Z");
});

test("guards: multiple punches, an already-complete shift, and too few times all error", () => {
  const multi = suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T09:00:00Z")],
    existingPunches: [
      { id: "a", clockIn: new Date("2026-11-16T08:00:00Z"), clockOut: null },
      { id: "b", clockIn: new Date("2026-11-16T14:00:00Z"), clockOut: null },
    ],
    overnightAllowed: false,
  });
  assert.ok("error" in multi, "multiple punches → manual");

  const complete = suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T09:00:00Z")],
    existingPunches: [{ id: "c", clockIn: new Date("2026-11-16T08:00:00Z"), clockOut: new Date("2026-11-16T16:00:00Z") }],
    overnightAllowed: false,
  });
  assert.ok("error" in complete, "already complete → time correction");

  const tooFew = suggestShiftPairing({
    enteredTimes: [new Date("2026-11-16T09:00:00Z")],
    existingPunches: [],
    overnightAllowed: false,
  });
  assert.ok("error" in tooFew, "one time, no punch → not enough to pair");
});
