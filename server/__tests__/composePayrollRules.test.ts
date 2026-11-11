import { test } from "node:test";
import assert from "node:assert/strict";
import { composePayrollRules, DEFAULT_PAYROLL_RULES } from "../policyEngine";

// The policy "preset" an employee would get with no overrides.
const policyRules = {
  payPeriodType: "biweekly",
  overtimeEnabled: true,
  overtimeMultiplier: 1.5,
  doubleTimeEnabled: true,
  doubleTimeMultiplier: 2.0,
  doubleTimeThresholdDaily: 12,
  includeHolidayPay: true,
  punctualityBonus: { enabled: false, bonusPerHour: 2, label: "Weekly Punctuality Bonus" },
};

test("no overrides returns the base rules object untouched (identity, not a copy)", () => {
  for (const empty of [undefined, null, {}]) {
    const out = composePayrollRules(policyRules, empty as any);
    assert.equal(out, policyRules); // same reference — a guaranteed no-op
  }
});

test("a single override replaces only that one rule; the rest follow the policy", () => {
  const out = composePayrollRules(policyRules, { overtimeMultiplier: 2.0 });
  assert.equal(out.overtimeMultiplier, 2.0); // overridden
  assert.equal(out.overtimeEnabled, true); // untouched
  assert.equal(out.doubleTimeThresholdDaily, 12); // untouched
  assert.equal(out.includeHolidayPay, true); // untouched
  // The base object is not mutated.
  assert.equal(policyRules.overtimeMultiplier, 1.5);
});

test("turning a rule OFF for one employee overrides just that flag", () => {
  const out = composePayrollRules(policyRules, { overtimeEnabled: false, includeHolidayPay: false });
  assert.equal(out.overtimeEnabled, false);
  assert.equal(out.includeHolidayPay, false);
  assert.equal(out.overtimeMultiplier, 1.5); // still the policy rate
});

test("a conditional-raise override replaces the WHOLE punctuality object (shallow by key)", () => {
  const out = composePayrollRules(policyRules, {
    punctualityBonus: { enabled: true, bonusPerHour: 2, label: "Weekly Punctuality Bonus" },
  });
  assert.deepEqual(out.punctualityBonus, { enabled: true, bonusPerHour: 2, label: "Weekly Punctuality Bonus" });
  assert.equal(policyRules.punctualityBonus.enabled, false); // base not mutated
});

test("overrides compose on top of DEFAULT_PAYROLL_RULES when an employee has no policy", () => {
  const out = composePayrollRules(DEFAULT_PAYROLL_RULES, { payPeriodType: "weekly", overtimeMultiplier: 1.75 });
  assert.equal(out.payPeriodType, "weekly");
  assert.equal(out.overtimeMultiplier, 1.75);
  assert.equal(out.doubleTimeMultiplier, DEFAULT_PAYROLL_RULES.doubleTimeMultiplier); // default fall-through
  assert.equal(DEFAULT_PAYROLL_RULES.payPeriodType, "biweekly"); // default not mutated
});
