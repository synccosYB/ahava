/**
 * Overtime is WEEKLY ONLY at Ahava: hours over 40 in the Thu–Wed workweek are
 * overtime; a long single day is NOT overtime on its own. The default policy
 * disables daily overtime (otThresholdDaily = null). A policy that still sets a
 * daily threshold (e.g. a frozen historical snapshot) keeps daily OT, so
 * already-paid periods recompute unchanged.
 *
 * Pure (payroll engine only). Run: `npx tsx server/__tests__/weeklyOnlyOvertime.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAY_CALC_POLICY, splitDailyHours, computeWeeklyHours, type PayCalcPolicy } from "../payrollEngine";

const WEEKLY_ONLY: PayCalcPolicy = { ...DEFAULT_PAY_CALC_POLICY, otThresholdDaily: null, otThresholdWeekly: 40, weeklyOvertimeEnabled: true, workweekStartDay: 4 };
const DAILY_8: PayCalcPolicy = { ...WEEKLY_ONLY, otThresholdDaily: 8 };

test("weekly-only: a long single day is not overtime", () => {
  const split = splitDailyHours(11, WEEKLY_ONLY);
  assert.equal(split.regularHours, 11, "all 11 hours are regular (no daily OT)");
  assert.equal(split.overtimeHours, 0, "no daily overtime");
  assert.equal(split.doubleTimeHours, 0, "no daily double-time");
});

test("Shaina's week: 32h50m over long days = 0 overtime", () => {
  // Thu/Fri/Sat of the Nov 19–25 workweek (workweekStartDay=4 → Nov 19 is Thu).
  const days = [
    { date: "2026-11-19", hours: 11, isHoliday: false },
    { date: "2026-11-20", hours: 11, isHoliday: false },
    { date: "2026-11-21", hours: 10.8333, isHoliday: false }, // ~10h50m → 32h50m total
  ];
  const wk = computeWeeklyHours(days, WEEKLY_ONLY);
  assert.equal(Math.round(wk.summary.totalHours * 100) / 100, 32.83, "total ~32h50m");
  assert.equal(wk.summary.overtimeHours, 0, "under 40h → no overtime");
});

test("a 45h week = 5h weekly overtime", () => {
  const days = [
    { date: "2026-11-19", hours: 11, isHoliday: false },
    { date: "2026-11-20", hours: 11, isHoliday: false },
    { date: "2026-11-21", hours: 11, isHoliday: false },
    { date: "2026-11-22", hours: 12, isHoliday: false },
  ]; // 45h
  const wk = computeWeeklyHours(days, WEEKLY_ONLY);
  assert.equal(wk.summary.totalHours, 45);
  assert.equal(wk.summary.overtimeHours, 5, "hours over 40 = 5h weekly OT");
});

test("backward-compat: a frozen daily-8 policy still gives daily OT", () => {
  const split = splitDailyHours(11, DAILY_8);
  assert.equal(split.overtimeHours, 3, "daily OT preserved for a frozen snapshot (11 - 8)");
  assert.equal(split.regularHours, 8);
});
