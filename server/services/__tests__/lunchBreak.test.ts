/**
 * Lunch-break pay math (F6). Pure, no DB. Covers every rule + the owner's
 * worked examples.
 *
 * Run with: `npx tsx server/services/__tests__/lunchBreak.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLunchBreaks, type ShiftInterval } from "../lunchBreak";

// Helper: build same-day intervals from "HH:MM" in/out pairs.
function day(pairs: [string, string][]): ShiftInterval[] {
  return pairs.map(([i, o]) => ({
    clockIn: new Date(`2026-11-05T${i}:00Z`),
    clockOut: new Date(`2026-11-05T${o}:00Z`),
  }));
}

test("no breaks (single shift) -> no lunch pay", () => {
  const r = computeLunchBreaks(day([["09:00", "17:00"]]));
  assert.equal(r.paidLunchMinutes, 0);
  assert.equal(r.newShiftGaps, 0);
});

test("one 60-min break -> paid 45, 15 unpaid, still a break", () => {
  // 09:00-12:00, gap 12:00-13:00 (60), 13:00-17:00
  const r = computeLunchBreaks(day([["09:00", "12:00"], ["13:00", "17:00"]]));
  assert.equal(r.qualifyingBreakMinutes, 60);
  assert.equal(r.paidLunchMinutes, 45);
  assert.equal(r.unpaidBreakMinutes, 15);
  assert.equal(r.newShiftGaps, 0);
});

test("one 75-min break -> new shift, 0 lunch pay", () => {
  // gap 12:00-13:15 = 75 min
  const r = computeLunchBreaks(day([["09:00", "12:00"], ["13:15", "17:00"]]));
  assert.equal(r.paidLunchMinutes, 0);
  assert.equal(r.qualifyingBreakMinutes, 0);
  assert.equal(r.newShiftGaps, 1);
});

test("short break (30) -> paid exactly what was taken", () => {
  const r = computeLunchBreaks(day([["09:00", "12:00"], ["12:30", "17:00"]]));
  assert.equal(r.paidLunchMinutes, 30);
  assert.equal(r.unpaidBreakMinutes, 0);
});

test("20 + 20 + 30 -> first two qualify (40 paid); the 30 is a new shift", () => {
  const r = computeLunchBreaks(
    day([
      ["08:00", "10:00"], // gap1 20
      ["10:20", "12:00"], // gap2 20
      ["12:20", "14:00"], // gap3 30 -> pushes to 70 -> new shift
      ["14:30", "17:00"],
    ]),
  );
  assert.equal(r.paidLunchMinutes, 40);
  assert.equal(r.qualifyingBreakMinutes, 40);
  assert.equal(r.newShiftGaps, 1);
});

test("30 + 30 -> second fills to 60; paid 45, 15 unpaid", () => {
  const r = computeLunchBreaks(
    day([
      ["09:00", "11:00"], // gap 30
      ["11:30", "13:00"], // gap 30 -> cumulative 60 (still a break)
      ["13:30", "17:00"],
    ]),
  );
  assert.equal(r.qualifyingBreakMinutes, 60);
  assert.equal(r.paidLunchMinutes, 45);
  assert.equal(r.unpaidBreakMinutes, 15);
  assert.equal(r.newShiftGaps, 0);
});

test("a later short gap after a new-shift gap can still be a break", () => {
  // gap1 70 -> new shift; gap2 10 -> cumulative 10 -> break, paid 10
  const r = computeLunchBreaks(
    day([
      ["06:00", "08:00"],
      ["09:10", "11:00"], // gap1 70 -> new shift
      ["11:10", "15:00"], // gap2 10 -> break
    ]),
  );
  assert.equal(r.newShiftGaps, 1);
  assert.equal(r.paidLunchMinutes, 10);
});
