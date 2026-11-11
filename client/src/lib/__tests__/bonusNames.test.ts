import { test } from "node:test";
import assert from "node:assert/strict";
import { bonusNames } from "../rule-summaries";

test("names a personal Sunday day-of-week bonus 'Sunday Bonus' (no amounts/conditions)", () => {
  const names = bonusNames(null, [{ dayOfWeek: 0, minHoursThreshold: 0, bonusType: "money", bonusAmount: 20 } as any]);
  assert.deepEqual(names, ["Sunday Bonus"]);
});

test("de-dupes a policy Sunday bonus and a personal Sunday bonus into one chip", () => {
  const names = bonusNames(
    { dayOfWeekBonuses: [{ dayOfWeek: 0, minHoursThreshold: 8, bonusType: "money", bonusAmount: 10 }] },
    [{ dayOfWeek: 0, minHoursThreshold: 0, bonusType: "money", bonusAmount: 25 } as any],
  );
  assert.deepEqual(names, ["Sunday Bonus"]);
});

test("includes the punctuality bonus label when enabled, skips it when off", () => {
  assert.deepEqual(
    bonusNames({ punctualityBonus: { enabled: true, bonusPerHour: 2, label: "Weekly Punctuality Bonus" } }),
    ["Weekly Punctuality Bonus"],
  );
  assert.deepEqual(bonusNames({ punctualityBonus: { enabled: false, bonusPerHour: 2 } }), []);
});

test("falls back to 'Punctuality Bonus' when enabled with no label", () => {
  assert.deepEqual(bonusNames({ punctualityBonus: { enabled: true, bonusPerHour: 3 } }), ["Punctuality Bonus"]);
});

test("names early-arrival bonuses generically and combines multiple bonus kinds in order", () => {
  const names = bonusNames({
    dayOfWeekBonuses: [{ dayOfWeek: 0 }, { dayOfWeek: 1 }],
    punctualityBonus: { enabled: true, bonusPerHour: 2, label: "On-time Raise" },
    earlyArrivalBonuses: [{ cutoffTime: "09:00", bonusAmountPerHour: 1 }],
  });
  assert.deepEqual(names, ["Sunday Bonus", "Monday Bonus", "On-time Raise", "Early Arrival Bonus"]);
});

test("no bonuses anywhere yields an empty list", () => {
  assert.deepEqual(bonusNames(null, null), []);
  assert.deepEqual(bonusNames({}, []), []);
});
