import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePayrollPolicy } from "./rule-summaries";

test("review distinguishes conditional cash and paid-hour bonuses, including Sunday", () => {
  const summary = summarizePayrollPolicy({ dayOfWeekBonuses: [
    { dayOfWeek: 0, minHoursThreshold: 4, bonusType: "money", bonusAmount: 25.5 },
    { dayOfWeek: 6, minHoursThreshold: 6, bonusType: "hours", bonusAmount: 2 },
  ] });
  assert.deepEqual(summary, ["Sunday ≥ 4h adds $25.50 bonus.", "Saturday ≥ 6h adds +2 hours paid."]);
});

test("review includes early-arrival scope and enabled weekly punctuality conditions", () => {
  const summary = summarizePayrollPolicy({
    punctualityBonus: { enabled: true, bonusPerHour: 2 },
    earlyArrivalBonuses: [{ cutoffTime: "08:00", daysOfWeek: [1, 2], minHoursThreshold: 4, bonusAmountPerHour: 3, applyScope: "before_cutoff" }],
  });
  assert.ok(summary.includes("Weekly punctuality bonus: +$2/hr when qualified; missed scheduled days require review."));
  assert.ok(summary.includes("Clock-in before 8:00 AM on Mon, Tue adds $3/hr, min 4h shift (before cutoff only)."));
  assert.deepEqual(summarizePayrollPolicy({ punctualityBonus: { enabled: false, bonusPerHour: 2 } }), []);
});
