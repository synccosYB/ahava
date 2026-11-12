import { test } from "node:test";
import assert from "node:assert/strict";
import { biweeklyPeriodFor, shiftBiweekly, BIWEEKLY_ANCHOR } from "../payroll-week";

// Ahava pays every 2 weeks, Thu→Wed, phase-anchored so periods start
// …, Oct 29 2026, Nov 12 2026, Nov 26 2026, … The current WORK period is the
// block containing today; the PAYROLL period is the one before it.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

test("the anchor is a period start", () => {
  assert.equal(BIWEEKLY_ANCHOR, "2026-10-29");
  const p = biweeklyPeriodFor(d(2026, 10, 29));
  assert.deepEqual(p, { start: "2026-10-29", end: "2026-11-11" });
});

test("a date mid-period resolves to that aligned Thu→Wed block (Nov 12–25)", () => {
  for (const day of [12, 15, 18, 25]) {
    assert.deepEqual(biweeklyPeriodFor(d(2026, 11, day)), { start: "2026-11-12", end: "2026-11-25" }, `Nov ${day}`);
  }
});

test("the day before a period start belongs to the previous period", () => {
  // Nov 11 (Wed) is the last day of Oct 29 – Nov 11, not the Nov 12 period.
  assert.deepEqual(biweeklyPeriodFor(d(2026, 11, 11)), { start: "2026-10-29", end: "2026-11-11" });
});

test("the next period starts exactly 14 days after (Nov 26 – Dec 9)", () => {
  assert.deepEqual(biweeklyPeriodFor(d(2026, 11, 26)), { start: "2026-11-26", end: "2026-12-09" });
});

test("shiftBiweekly steps whole 14-day periods, keeping the phase", () => {
  const work = { start: "2026-11-12", end: "2026-11-25" };
  assert.deepEqual(shiftBiweekly(work, -1), { start: "2026-10-29", end: "2026-11-11" }); // payroll period
  assert.deepEqual(shiftBiweekly(work, 1), { start: "2026-11-26", end: "2026-12-09" });
  assert.deepEqual(shiftBiweekly(work, -2), { start: "2026-10-15", end: "2026-10-28" });
});

test("periods never overlap and are exactly 14 days (no rolling)", () => {
  const a = biweeklyPeriodFor(d(2026, 11, 12));
  const next = shiftBiweekly(a, 1);
  // a.end (Nov 25) + 1 day === next.start (Nov 26)
  const dayAfterEnd = new Date(Date.parse(a.end + "T00:00:00") + 86400000);
  const iso = `${dayAfterEnd.getFullYear()}-${String(dayAfterEnd.getMonth() + 1).padStart(2, "0")}-${String(dayAfterEnd.getDate()).padStart(2, "0")}`;
  assert.equal(iso, next.start);
});
