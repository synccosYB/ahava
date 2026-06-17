/**
 * Golden matrix for the single authoritative pay engine (`server/payrollEngine.ts`).
 *
 * These pure-function tests pin the daily regular/overtime/double-time split,
 * the gross-pay multiplier math, and the range aggregation so that every
 * consumer (clock-out, timesheet, reports, payroll create/CSV/summary,
 * reconciliation) computes identical numbers. If this matrix changes, payroll
 * dollars change — so the expected values are written out by hand.
 *
 * Run with: `tsx server/__tests__/payrollEngine.test.ts`
 */
import assert from "node:assert/strict";

const {
  round2,
  buildPayCalcPolicy,
  splitDailyHours,
  computeGrossPay,
  summarizeDailyHours,
  computeWeeklyHours,
  workweekStartFor,
  DEFAULT_PAY_CALC_POLICY,
} = await import("../payrollEngine.js");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
}

// --- round2 ---
check("round2 rounds to cents", () => {
  assert.equal(round2(1.005), 1.0); // standard JS float rounding
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(8.126), 8.13);
});

// --- buildPayCalcPolicy defaults & toggles ---
check("buildPayCalcPolicy falls back to defaults", () => {
  const p = buildPayCalcPolicy(undefined, undefined, undefined);
  assert.equal(p.otThresholdDaily, DEFAULT_PAY_CALC_POLICY.otThresholdDaily);
  assert.equal(p.overtimeMultiplier, DEFAULT_PAY_CALC_POLICY.overtimeMultiplier);
  assert.equal(p.doubleTimeMultiplier, DEFAULT_PAY_CALC_POLICY.doubleTimeMultiplier);
  assert.equal(p.autoCalculateOT, true);
  assert.equal(p.overtimeEnabled, true);
  assert.equal(p.doubleTimeEnabled, true);
});

check("buildPayCalcPolicy treats missing toggles as enabled, explicit false as off", () => {
  const on = buildPayCalcPolicy({}, {}, {});
  assert.equal(on.overtimeEnabled, true);
  const off = buildPayCalcPolicy({}, { overtimeEnabled: false, autoCalculateOT: false }, {});
  assert.equal(off.overtimeEnabled, false);
  assert.equal(off.autoCalculateOT, false);
});

check("buildPayCalcPolicy reads custom knobs + versions", () => {
  const p = buildPayCalcPolicy(
    { otThresholdDaily: 10 },
    { doubleTimeThresholdDaily: 12, overtimeMultiplier: 1.25, doubleTimeMultiplier: 2.5 },
    { holidayOtExclusion: true },
    { attendance: 3, payroll: 7 },
  );
  assert.equal(p.otThresholdDaily, 10);
  assert.equal(p.doubleTimeThresholdDaily, 12);
  assert.equal(p.overtimeMultiplier, 1.25);
  assert.equal(p.doubleTimeMultiplier, 2.5);
  assert.equal(p.holidayOtExclusion, true);
  assert.equal(p.attendancePolicyVersion, 3);
  assert.equal(p.payrollPolicyVersion, 7);
});

// --- splitDailyHours: the daily regular/OT/DT split ---
const std = buildPayCalcPolicy(
  { otThresholdDaily: 8 },
  { doubleTimeThresholdDaily: 12, overtimeMultiplier: 1.5, doubleTimeMultiplier: 2 },
  {},
);

check("split: under threshold is all regular", () => {
  const s = splitDailyHours(6, std);
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [6, 0, 0]);
  assert.equal(s.status, "complete");
});

check("split: exactly at OT threshold is all regular", () => {
  const s = splitDailyHours(8, std);
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [8, 0, 0]);
});

check("split: between OT and DT thresholds yields OT", () => {
  const s = splitDailyHours(10, std);
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [8, 2, 0]);
  assert.equal(s.status, "overtime");
});

check("split: beyond DT threshold yields OT capped + DT", () => {
  const s = splitDailyHours(14, std);
  // reg 8, OT 8..12 = 4, DT 12..14 = 2
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [8, 4, 2]);
});

check("split: DT disabled means all over-OT is overtime", () => {
  const noDt = buildPayCalcPolicy({ otThresholdDaily: 8 }, { doubleTimeEnabled: false }, {});
  const s = splitDailyHours(14, noDt);
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [8, 6, 0]);
});

check("split: OT disabled keeps everything regular", () => {
  const off = buildPayCalcPolicy({ otThresholdDaily: 8 }, { overtimeEnabled: false }, {});
  const s = splitDailyHours(14, off);
  assert.deepEqual([s.regularHours, s.overtimeHours, s.doubleTimeHours], [14, 0, 0]);
});

check("split: holiday with exclusion keeps all regular; without exclusion splits", () => {
  const excl = buildPayCalcPolicy({ otThresholdDaily: 8 }, { doubleTimeThresholdDaily: 12 }, { holidayOtExclusion: true });
  const sExcl = splitDailyHours(14, excl, { isHoliday: true });
  assert.deepEqual([sExcl.regularHours, sExcl.overtimeHours, sExcl.doubleTimeHours], [14, 0, 0]);
  // holiday but exclusion off -> normal split
  const noExcl = buildPayCalcPolicy({ otThresholdDaily: 8 }, { doubleTimeThresholdDaily: 12 }, { holidayOtExclusion: false });
  const sNo = splitDailyHours(14, noExcl, { isHoliday: true });
  assert.deepEqual([sNo.regularHours, sNo.overtimeHours, sNo.doubleTimeHours], [8, 4, 2]);
});

check("split: negative/zero hours normalize to zero", () => {
  const s = splitDailyHours(-5, std);
  assert.deepEqual([s.hoursWorked, s.regularHours, s.overtimeHours, s.doubleTimeHours], [0, 0, 0, 0]);
});

// --- computeGrossPay: multiplier math ---
check("gross pay applies OT and DT multipliers", () => {
  // 8 reg + 4 OT + 2 DT at $10, 1.5x / 2x
  const pay = computeGrossPay(
    { regularHours: 8, overtimeHours: 4, doubleTimeHours: 2 },
    10,
    { overtimeMultiplier: 1.5, doubleTimeMultiplier: 2 },
  );
  // 80 + 4*10*1.5 (60) + 2*10*2 (40) = 180
  assert.equal(pay, 180);
});

check("gross pay regular-only", () => {
  const pay = computeGrossPay({ regularHours: 8, overtimeHours: 0, doubleTimeHours: 0 }, 25, { overtimeMultiplier: 1.5, doubleTimeMultiplier: 2 });
  assert.equal(pay, 200);
});

check("gross pay zero rate is zero", () => {
  const pay = computeGrossPay({ regularHours: 8, overtimeHours: 4, doubleTimeHours: 2 }, 0, { overtimeMultiplier: 1.5, doubleTimeMultiplier: 2 });
  assert.equal(pay, 0);
});

// --- summarizeDailyHours: range aggregation (the days*8 fix) ---
check("summarize splits EACH day, not the range total", () => {
  // Two 10h days: old "total(20) - days(2)*8 = 4" OT was right here, but
  // mixing a long and short day is where the old math broke.
  const sum = summarizeDailyHours([{ hours: 10 }, { hours: 10 }], std);
  assert.equal(sum.regularHours, 16);
  assert.equal(sum.overtimeHours, 4);
  assert.equal(sum.doubleTimeHours, 0);
  assert.equal(sum.daysWorked, 2);
  assert.equal(sum.totalHours, 20);
});

check("summarize: long + short day do NOT net against each other", () => {
  // 12h day (reg 8, OT 4) + 4h day (reg 4). Old "20 - 2*8 = 4 OT" happens to
  // match here, but a 14h + 2h split exposes the difference:
  const sum = summarizeDailyHours([{ hours: 14 }, { hours: 2 }], std);
  // day1: reg8/ot4/dt2 ; day2: reg2 -> reg10/ot4/dt2
  assert.equal(sum.regularHours, 10);
  assert.equal(sum.overtimeHours, 4);
  assert.equal(sum.doubleTimeHours, 2);
  // old formula would have said OT = 16 - 2*8 = 0, which is wrong.
});

check("summarize ignores zero/empty days for daysWorked", () => {
  const sum = summarizeDailyHours([{ hours: 0 }, { hours: 8 }, { hours: 0 }], std);
  assert.equal(sum.daysWorked, 1);
  assert.equal(sum.regularHours, 8);
});

check("summarize honors per-day holiday exclusion", () => {
  const excl = buildPayCalcPolicy({ otThresholdDaily: 8 }, { doubleTimeThresholdDaily: 12 }, { holidayOtExclusion: true });
  const sum = summarizeDailyHours([{ hours: 14, isHoliday: true }, { hours: 10 }], excl);
  // holiday day all regular (14), normal day reg8/ot2 -> reg22/ot2
  assert.equal(sum.regularHours, 22);
  assert.equal(sum.overtimeHours, 2);
  assert.equal(sum.doubleTimeHours, 0);
});

// --- computeWeeklyHours: weekly overtime (the 40h/week rule) ---
// A Sun-anchored workweek (default workweekStartDay = 0). 2024-01-07 is a Sunday.
const week = (offset: number) => {
  const dt = new Date(Date.UTC(2024, 0, 7 + offset));
  return dt.toISOString().split("T")[0];
};
const fiveDays = (hoursPerDay: number) =>
  [0, 1, 2, 3, 4].map((i) => ({ date: week(i), hours: hoursPerDay }));

// CASE 1: daily threshold high enough that no DAILY OT triggers, but the week
// crosses 40 → the excess regular hours become WEEKLY overtime.
// 5 × 9h = 45h, daily OT threshold 10 (so each 9h day is all regular), weekly 40.
check("weekly: 5x9h with high daily threshold → 5h weekly OT", () => {
  const policy = buildPayCalcPolicy(
    { otThresholdDaily: 10, otThresholdWeekly: 40 },
    { doubleTimeThresholdDaily: 12 },
    {},
  );
  const res = computeWeeklyHours(fiveDays(9), policy);
  assert.equal(res.summary.regularHours, 40);
  assert.equal(res.summary.overtimeHours, 5);
  assert.equal(res.summary.weeklyOvertimeHours, 5);
  assert.equal(res.summary.doubleTimeHours, 0);
  // No hour double-counted: reg + OT + DT === total worked.
  assert.equal(
    round2(res.summary.regularHours + res.summary.overtimeHours + res.summary.doubleTimeHours),
    res.summary.totalHours,
  );
  // Distributed latest-day-first: the last worked day absorbs the 5h.
  const last = res.days[res.days.length - 1];
  assert.equal(last.overtimeHours, 5);
  assert.equal(last.weeklyOvertimeHours, 5);
});

// CASE 2: DAILY OT already accounts for everything over 40, so weekly OT adds
// nothing (no double counting). 5 × 10h, daily threshold 8 → each day reg8/OT2
// = reg40/OT10 for the week; weekly threshold 40 sees 40 regular → 0 weekly OT.
check("weekly: 5x10h default thresholds → daily OT only, no extra weekly OT", () => {
  const policy = buildPayCalcPolicy(
    { otThresholdDaily: 8, otThresholdWeekly: 40 },
    { doubleTimeThresholdDaily: 12 },
    {},
  );
  const res = computeWeeklyHours(fiveDays(10), policy);
  assert.equal(res.summary.regularHours, 40);
  assert.equal(res.summary.overtimeHours, 10);
  assert.equal(res.summary.weeklyOvertimeHours, 0);
  assert.equal(res.summary.doubleTimeHours, 0);
});

// CASE 3: lowering the WEEKLY threshold reclassifies more regular hours, while
// disabling weekly OT (or auto-OT) leaves them regular — same hours, policy-driven.
check("weekly: lower weekly threshold reclassifies more; disabled keeps regular", () => {
  const at35 = buildPayCalcPolicy(
    { otThresholdDaily: 10, otThresholdWeekly: 35 },
    { doubleTimeThresholdDaily: 12 },
    {},
  );
  const res35 = computeWeeklyHours(fiveDays(9), at35);
  // 45 regular - 35 = 10 weekly OT.
  assert.equal(res35.summary.regularHours, 35);
  assert.equal(res35.summary.overtimeHours, 10);
  assert.equal(res35.summary.weeklyOvertimeHours, 10);

  const off = buildPayCalcPolicy(
    { otThresholdDaily: 10, otThresholdWeekly: 35, weeklyOvertimeEnabled: false },
    { doubleTimeThresholdDaily: 12 },
    {},
  );
  const resOff = computeWeeklyHours(fiveDays(9), off);
  assert.equal(resOff.summary.regularHours, 45);
  assert.equal(resOff.summary.overtimeHours, 0);
  assert.equal(resOff.summary.weeklyOvertimeHours, 0);
});

// CASE 4: every consumer feeds the SAME engine → identical numbers. Two weeks of
// data are bucketed independently by workweek (Sun-anchored), and the per-day
// rows that batch creation / reconciliation would store sum to the summary that
// reports / timesheet show. Holiday-excluded days stay out of the threshold.
check("weekly: workweeks bucket independently; per-day rows reconcile to summary", () => {
  const policy = buildPayCalcPolicy(
    { otThresholdDaily: 10, otThresholdWeekly: 40, workweekStartDay: 0 },
    { doubleTimeThresholdDaily: 12 },
    {},
  );
  // Week A (Sun 1/7 … Sat 1/13): 5×9h = 45 → 5 weekly OT.
  // Week B (Sun 1/14 …): 3×9h = 27 → 0 weekly OT (under 40).
  const days = [
    ...[0, 1, 2, 3, 4].map((i) => ({ date: week(i), hours: 9 })),
    ...[7, 8, 9].map((i) => ({ date: week(i), hours: 9 })),
  ];
  // Both weeks anchor to their own Sunday.
  assert.equal(workweekStartFor(week(4), 0), week(0));
  assert.equal(workweekStartFor(week(7), 0), week(7));

  const res = computeWeeklyHours(days, policy);
  assert.equal(res.summary.overtimeHours, 5); // only week A crosses 40
  assert.equal(res.summary.weeklyOvertimeHours, 5);
  assert.equal(res.summary.regularHours, 45 - 5 + 27); // 67

  // The per-day rows (what payroll batch stores & reconciliation re-derives)
  // sum back to the same summary a range report shows — proving all consumers
  // agree when fed the same engine output.
  const sumReg = round2(res.days.reduce((a, d) => a + d.regularHours, 0));
  const sumOt = round2(res.days.reduce((a, d) => a + d.overtimeHours, 0));
  const sumWeekly = round2(res.days.reduce((a, d) => a + d.weeklyOvertimeHours, 0));
  assert.equal(sumReg, res.summary.regularHours);
  assert.equal(sumOt, res.summary.overtimeHours);
  assert.equal(sumWeekly, res.summary.weeklyOvertimeHours);
});

// CASE 5 (alert/pay parity): holiday-excluded days must NOT count toward the
// weekly threshold — the exact mismatch the overtime alert had before it routed
// through computeWeeklyHours. 5×9h regular + a 6th 8h day worked on a holiday
// (with holidayOtExclusion). Only the 45 non-holiday regular hours feed the 40h
// threshold → 5h weekly OT; the holiday day stays all-regular and outside it.
check("weekly: holiday-excluded day stays out of the weekly threshold (alert/pay parity)", () => {
  const policy = buildPayCalcPolicy(
    { otThresholdDaily: 10, otThresholdWeekly: 40 },
    { doubleTimeThresholdDaily: 12 },
    { holidayOtExclusion: true },
  );
  const days = [
    ...[0, 1, 2, 3, 4].map((i) => ({ date: week(i), hours: 9 })),
    { date: week(5), hours: 8, isHoliday: true },
  ];
  const res = computeWeeklyHours(days, policy);
  assert.equal(res.summary.weeklyOvertimeHours, 5); // only the 45 eligible hours cross 40
  assert.equal(res.summary.overtimeHours, 5);
  assert.equal(res.summary.regularHours, 48); // 40 eligible + 8 holiday, all regular
  assert.equal(res.summary.totalHours, 53);
  // The holiday day itself is never reclassified.
  const holiday = res.days.find((d) => d.date === week(5))!;
  assert.equal(holiday.regularHours, 8);
  assert.equal(holiday.overtimeHours, 0);
});

// CASE 6 (no double-count under daily+weekly): daily OT fires first, THEN weekly
// OT reclassifies only the hours still regular. 6×9h, daily threshold 8 → each
// day reg8/OT1 (daily OT 6, regular 48). Weekly threshold 40 sees 48 regular →
// 8h weekly OT. Final: reg40 / OT14 (6 daily + 8 weekly) / total 54 — every hour
// accounted for exactly once, and the per-day rows sum to the summary.
check("weekly: daily + weekly OT combine without double-counting", () => {
  const policy = buildPayCalcPolicy(
    { otThresholdDaily: 8, otThresholdWeekly: 40 },
    { doubleTimeThresholdDaily: 20 },
    {},
  );
  const days = [0, 1, 2, 3, 4, 5].map((i) => ({ date: week(i), hours: 9 }));
  const res = computeWeeklyHours(days, policy);
  assert.equal(res.summary.regularHours, 40);
  assert.equal(res.summary.overtimeHours, 14);
  assert.equal(res.summary.weeklyOvertimeHours, 8);
  assert.equal(res.summary.doubleTimeHours, 0);
  assert.equal(res.summary.totalHours, 54);
  assert.equal(
    round2(res.summary.regularHours + res.summary.overtimeHours + res.summary.doubleTimeHours),
    res.summary.totalHours,
  );
  // Per-day rows (payroll batch storage / reconciliation / dashboard inputs) sum
  // back to the same totals reports & timesheet display — all consumers agree.
  const sumReg = round2(res.days.reduce((a, d) => a + d.regularHours, 0));
  const sumOt = round2(res.days.reduce((a, d) => a + d.overtimeHours, 0));
  assert.equal(sumReg, res.summary.regularHours);
  assert.equal(sumOt, res.summary.overtimeHours);
});

console.log(`✓ payrollEngine: all ${passed} assertions passed`);
