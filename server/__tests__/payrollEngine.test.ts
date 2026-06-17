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

console.log(`✓ payrollEngine: all ${passed} assertions passed`);
