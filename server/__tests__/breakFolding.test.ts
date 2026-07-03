/**
 * Pure-logic coverage for the Take Break / End Break math.
 *
 *   - computeBreakElapsedMinutes (server/punchHours.ts) — the SINGLE formula
 *     used when ending a break, whose result is folded into break_minutes.
 *   - No-double-count guarantee: a folded break subtracts from paid hours
 *     exactly once via the existing computePunchHoursWorked break-minutes path.
 *
 * Run with: `npx tsx server/__tests__/breakFolding.test.ts`
 * (no DATABASE_URL required — these never touch the DB).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBreakElapsedMinutes, computePunchHoursWorked } from "../punchHours";
import { computeAutoClockOutValues } from "../services/policyEnforcement";

const at = (h: number, m = 0) => new Date(Date.UTC(2025, 0, 15, h, m, 0, 0));

test("computeBreakElapsedMinutes: rounds whole minutes from start to now", () => {
  assert.equal(computeBreakElapsedMinutes(at(12, 0), at(12, 30)), 30);
  assert.equal(computeBreakElapsedMinutes(at(12, 0), at(12, 0)), 0);
});

test("computeBreakElapsedMinutes: rounds to nearest minute", () => {
  // 29m40s → 30, 15m20s → 15
  assert.equal(computeBreakElapsedMinutes(at(12, 0), new Date(at(12, 29).getTime() + 40000)), 30);
  assert.equal(computeBreakElapsedMinutes(at(12, 0), new Date(at(12, 15).getTime() + 20000)), 15);
});

test("computeBreakElapsedMinutes: never negative for reversed/invalid input", () => {
  assert.equal(computeBreakElapsedMinutes(at(12, 30), at(12, 0)), 0);
  assert.equal(computeBreakElapsedMinutes(null), 0);
  assert.equal(computeBreakElapsedMinutes(undefined), 0);
});

test("computeBreakElapsedMinutes: accepts ISO strings and a numeric now", () => {
  assert.equal(computeBreakElapsedMinutes(at(9, 0).toISOString(), at(9, 45).getTime()), 45);
});

test("break folds into break_minutes and deducts from paid hours exactly once", () => {
  // Employee works 9:00 → 17:00 (8h) and takes a 30-minute break. Ending the
  // break folds 30 into break_minutes; the SAME break-minutes path in
  // computePunchHoursWorked subtracts it once → 7.5 paid hours (no double count).
  const priorBreakMinutes = 0;
  const elapsed = computeBreakElapsedMinutes(at(12, 0), at(12, 30));
  const foldedBreakMinutes = priorBreakMinutes + elapsed;
  const hours = computePunchHoursWorked({
    clockIn: at(9, 0),
    clockOut: at(17, 0),
    breakMinutes: foldedBreakMinutes,
  });
  assert.equal(foldedBreakMinutes, 30);
  assert.equal(hours, 7.5);
});

test("multiple breaks accumulate into the single break_minutes total", () => {
  let breakMinutes = 0;
  breakMinutes += computeBreakElapsedMinutes(at(11, 0), at(11, 15)); // 15
  breakMinutes += computeBreakElapsedMinutes(at(14, 0), at(14, 30)); // 30
  const hours = computePunchHoursWorked({
    clockIn: at(9, 0),
    clockOut: at(17, 0),
    breakMinutes,
  });
  assert.equal(breakMinutes, 45);
  assert.equal(hours, 7.25);
});

// --- auto clock-out folds an active break --------------------------------
// Mirrors the runAutoClockOut path: when a shift is auto-closed while the
// employee is still on break, the elapsed break time is folded into
// break_minutes and deducted from the capped hours — exactly like a manual
// clock-out. (The break marker is separately cleared to null on the row.)

test("auto clock-out with no active break subtracts only prior break minutes", () => {
  const { hoursWorked } = computeAutoClockOutValues({
    actualClockIn: at(0, 0),
    roundedClockIn: at(0, 0),
    breakMinutes: 0,
    autoClockOutAfterHours: 16,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(hoursWorked, 16);
});

test("auto clock-out folds a live break into hoursWorked exactly once", () => {
  // Started at 00:00, still on break since 15:30 when auto clock-out fires at
  // the 16h cap (16:00). Elapsed break = 30 min → folded, so 16h - 0.5h = 15.5.
  const priorBreak = 0;
  const foldedBreak = priorBreak + computeBreakElapsedMinutes(at(15, 30), at(16, 0));
  const { hoursWorked } = computeAutoClockOutValues({
    actualClockIn: at(0, 0),
    roundedClockIn: at(0, 0),
    breakMinutes: foldedBreak,
    autoClockOutAfterHours: 16,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(foldedBreak, 30);
  assert.equal(hoursWorked, 15.5);
});

test("auto clock-out adds a live break on top of already-taken break minutes", () => {
  // 45 min already banked earlier + 30 min live break at auto clock-out = 75.
  const foldedBreak = 45 + computeBreakElapsedMinutes(at(15, 30), at(16, 0));
  const { hoursWorked } = computeAutoClockOutValues({
    actualClockIn: at(0, 0),
    roundedClockIn: at(0, 0),
    breakMinutes: foldedBreak,
    autoClockOutAfterHours: 16,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(foldedBreak, 75);
  assert.equal(hoursWorked, 16 - 75 / 60);
});

test("auto clock-out that runs LATE bounds the break at the capped close, not job time", () => {
  // Shift opened 00:00, cap 16h → effective close 16:00. Break started 15:30.
  // The background job actually runs at 20:00 (4h late). The break must be
  // measured only to the 16:00 close (30 min), NOT to 20:00 (4h30m), or the
  // employee would be underpaid. This mirrors runAutoClockOut's use of the
  // capped close timestamp as the elapsed ceiling.
  const cap = 16;
  const actualClockIn = at(0, 0);
  const effectiveClose = new Date(actualClockIn.getTime() + cap * 60 * 60 * 1000); // 16:00
  const jobRanAt = at(20, 0); // 4h late — must NOT influence the deduction

  const boundedElapsed = computeBreakElapsedMinutes(at(15, 30), effectiveClose);
  const unboundedElapsed = computeBreakElapsedMinutes(at(15, 30), jobRanAt);
  assert.equal(boundedElapsed, 30);
  assert.equal(unboundedElapsed, 270); // what we must AVOID counting
  assert.notEqual(boundedElapsed, unboundedElapsed);

  const { hoursWorked } = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn: actualClockIn,
    breakMinutes: boundedElapsed,
    autoClockOutAfterHours: cap,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(hoursWorked, 15.5);
});
