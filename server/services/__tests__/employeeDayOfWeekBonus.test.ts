import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDayOfWeekBonuses, evaluateDayOfWeekBonusesCombined } from "../policyEnforcement";

// 2026-11-08 is a Sunday (day 0). Use UTC dates like the engine does.
const SUNDAY = "2026-11-08";
const MONDAY = "2026-11-09";

const policyRules = {
  dayOfWeekBonuses: [
    { id: "p1", dayOfWeek: 0, minHoursThreshold: 8, bonusType: "money", bonusAmount: 10 },
  ],
};

test("per-employee Sunday money bonus is additive on top of the policy bonus", () => {
  const employeeBonuses = [
    { id: "e1", dayOfWeek: 0, minHoursThreshold: 0, bonusType: "money", bonusAmount: 25 },
  ];
  // 9 hours on Sunday: policy ($10, needs 8h) + employee ($25, needs 0h) = $35.
  const combined = evaluateDayOfWeekBonusesCombined(SUNDAY, 9, policyRules, employeeBonuses);
  assert.equal(combined.bonusAmount, 35);
  assert.equal(combined.descriptions.length, 2);

  // Policy-only (no employee bonuses) stays $10 — proves additivity, not replacement.
  assert.equal(evaluateDayOfWeekBonuses(SUNDAY, 9, policyRules).bonusAmount, 10);
});

test("employee bonus respects its own min-hours threshold and day", () => {
  const employeeBonuses = [
    { id: "e1", dayOfWeek: 0, minHoursThreshold: 6, bonusType: "money", bonusAmount: 25 },
  ];
  // 5 hours on Sunday: below the employee's 6h threshold AND below the policy's 8h,
  // so neither applies → $0.
  assert.equal(evaluateDayOfWeekBonusesCombined(SUNDAY, 5, policyRules, employeeBonuses).bonusAmount, 0);
  // A Monday shift never triggers a Sunday rule.
  assert.equal(evaluateDayOfWeekBonusesCombined(MONDAY, 9, policyRules, employeeBonuses).bonusAmount, 0);
});

test("employee hours bonus adds paid hours, not money", () => {
  const employeeBonuses = [
    { id: "e1", dayOfWeek: 0, minHoursThreshold: 0, bonusType: "hours", bonusAmount: 2 },
  ];
  const combined = evaluateDayOfWeekBonusesCombined(SUNDAY, 9, policyRules, employeeBonuses);
  assert.equal(combined.bonusHours, 2);
  assert.equal(combined.bonusAmount, 10); // policy money only
});

test("no employee bonuses leaves the result identical to policy-only", () => {
  for (const empty of [[], null, undefined]) {
    const combined = evaluateDayOfWeekBonusesCombined(SUNDAY, 9, policyRules, empty as unknown);
    assert.equal(combined.bonusAmount, 10);
    assert.equal(combined.bonusHours, 0);
  }
});
