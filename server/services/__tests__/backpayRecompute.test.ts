/**
 * computeBackpayDelta: full-weekly-recompute of pay owed when a correction hits
 * an already-paid day. Pure — no DB.
 *
 * Run with: `npx tsx --test server/services/__tests__/backpayRecompute.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBackpayDelta, type PaidDaySplit } from "../backpayRecompute";
import { DEFAULT_PAY_CALC_POLICY, type PayCalcPolicy } from "../../payrollEngine";

const policy = (over: Partial<PayCalcPolicy> = {}): PayCalcPolicy => ({
  ...DEFAULT_PAY_CALC_POLICY,
  otThresholdDaily: 8,
  otThresholdWeekly: 40,
  weeklyOvertimeEnabled: true,
  workweekStartDay: 0, // Sunday
  doubleTimeThresholdDaily: null,
  autoCalculateOT: true,
  overtimeEnabled: true,
  ...over,
});

const paid = (entries: Record<string, Partial<PaidDaySplit>>): Map<string, PaidDaySplit> =>
  new Map(
    Object.entries(entries).map(([d, s]) => [
      d,
      { regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, ...s },
    ]),
  );

const rate = { hourlyRate: 20, overtimeMultiplier: 1.5, doubleTimeMultiplier: 2 };

test("added regular hours, no OT: paid 4h, corrected 8h → +4 regular", () => {
  const d = computeBackpayDelta({
    correctedDays: [{ date: "2026-05-11", hours: 8 }],
    paidByDate: paid({ "2026-05-11": { regularHours: 4 } }),
    policy: policy(),
    rate,
  });
  assert.equal(d.regularHours, 4);
  assert.equal(d.overtimeHours, 0);
  assert.equal(d.doubleTimeHours, 0);
  assert.equal(d.isZero, false);
  assert.equal(d.hourlyRate, 20);
});

test("added hours cross the daily OT threshold: paid 8h reg, corrected 10h → +0 reg, +2 OT", () => {
  const d = computeBackpayDelta({
    correctedDays: [{ date: "2026-05-11", hours: 10 }],
    paidByDate: paid({ "2026-05-11": { regularHours: 8 } }),
    policy: policy(),
    rate,
  });
  assert.equal(d.regularHours, 0, "regular unchanged (both cap at 8)");
  assert.equal(d.overtimeHours, 2, "the 2 extra hours are daily OT");
});

test("claw-back: paid 8h, corrected down to 6h → -2 regular (deduct on next payroll)", () => {
  const d = computeBackpayDelta({
    correctedDays: [{ date: "2026-05-11", hours: 6 }],
    paidByDate: paid({ "2026-05-11": { regularHours: 8 } }),
    policy: policy(),
    rate,
  });
  assert.equal(d.regularHours, -2, "signed negative delta");
  assert.equal(d.isZero, false);
});

test("FULL WEEKLY recompute: +4h on one day pushes the week over 40 → the added hours become weekly OT, not regular", () => {
  // Daily OT off (threshold 24) so ONLY the weekly rule fires. Paid: 5×8 = 40
  // regular, no OT. Correction makes Friday 12h → 44h week → 4h weekly OT.
  const days = ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"];
  const d = computeBackpayDelta({
    correctedDays: days.map((date, i) => ({ date, hours: i === 4 ? 12 : 8 })),
    paidByDate: paid(Object.fromEntries(days.map((date) => [date, { regularHours: 8 }]))),
    policy: policy({ otThresholdDaily: 24 }),
    rate,
  });
  assert.equal(d.regularHours, 0, "regular total still 40 (unchanged)");
  assert.equal(d.overtimeHours, 4, "the 4 added hours land in weekly OT");
  assert.equal(d.doubleTimeHours, 0);
});

test("no change: corrected hours equal what was paid → isZero", () => {
  const d = computeBackpayDelta({
    correctedDays: [
      { date: "2026-05-11", hours: 8 },
      { date: "2026-05-12", hours: 8 },
    ],
    paidByDate: paid({ "2026-05-11": { regularHours: 8 }, "2026-05-12": { regularHours: 8 } }),
    policy: policy(),
    rate,
  });
  assert.equal(d.isZero, true);
  assert.equal(d.regularHours, 0);
  assert.equal(d.overtimeHours, 0);
});

test("paid days outside the corrected set are ignored (scoped to the week ∩ export)", () => {
  const d = computeBackpayDelta({
    correctedDays: [{ date: "2026-05-11", hours: 8 }],
    paidByDate: paid({
      "2026-05-11": { regularHours: 8 },
      "2026-05-18": { regularHours: 8 }, // a different week — must not count
    }),
    policy: policy(),
    rate,
  });
  assert.equal(d.isZero, true, "only the in-scope day is compared");
});
