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

// --- Lunch-required employees: full day adjustment (computeLunchAdjustedHours) ---
import { computeLunchAdjustedHours, type LunchDayPunch } from "../lunchBreak";

function punch(i: string | null, o: string | null, opts: { missing?: boolean; open?: boolean } = {}): LunchDayPunch {
  return {
    clockIn: i ? new Date(`2026-11-05T${i}:00Z`) : null,
    clockOut: o && !opts.missing ? new Date(`2026-11-05T${o}:00Z`) : null,
    openInProgress: !!opts.open,
  };
}
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: got ${a}, want ${b}`);

test("lunch required: clean lunch within the hour -> full span paid", () => {
  // in 9:03, lunch-out 12:15, back 12:59 (44m), out 17:00. base = 3.2 + 4.0167.
  const base = 3.2 + (4 + 1 / 60);
  const r = computeLunchAdjustedHours(
    [punch("09:03", "12:15"), punch("12:59", "17:00")], base,
  );
  near(r, (17 - 9 - 3 / 60), "full span 9:03->17:00"); // 7.95h
});

test("lunch required: 50-min lunch within the hour -> paid capped at 45", () => {
  const base = 3 + (4 + 10 / 60); // 09-12 + 12:50-17:00
  const r = computeLunchAdjustedHours([punch("09:00", "12:00"), punch("12:50", "17:00")], base);
  near(r, base + 45 / 60, "base + 45m paid"); // 7h55
});

test("lunch required: over the hour (clocked back) -> two shifts, no fine", () => {
  const base = 3 + (3 + 50 / 60); // 09-12 + 13:10-17:00 (70m gap)
  const r = computeLunchAdjustedHours([punch("09:00", "12:00"), punch("13:10", "17:00")], base);
  near(r, base, "two shifts, lunch unpaid"); // 6h50
});

test("lunch required: worked straight through -> span minus 45 fine", () => {
  const r = computeLunchAdjustedHours([punch("09:00", "17:00")], 8);
  near(r, 8 - 45 / 60, "8h - 45m"); // 7h15
});

test("lunch required: forgot to clock back in -> one shift (first->last) minus 45", () => {
  // in 9:00, lunch-out 12:00, forgot; a swept missing punch sits at 17:00.
  const base = 3; // only the 9-12 pair carries worked hours
  const r = computeLunchAdjustedHours(
    [punch("09:00", "12:00"), punch("17:00", null, { missing: true })], base,
  );
  near(r, 8 - 45 / 60, "span 9->17 (8h) - 45m"); // 7h15
});

test("lunch required: still clocked in (in progress) -> no fine yet", () => {
  const r = computeLunchAdjustedHours([punch("09:00", null, { open: true })], 3);
  near(r, 3, "defer while open");
});

test("lunch required: short shift with no lunch -> no fine (too short to owe one)", () => {
  const r = computeLunchAdjustedHours([punch("09:00", "11:00")], 2);
  near(r, 2, "2h shift not fined");
});
