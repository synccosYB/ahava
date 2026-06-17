/**
 * Unit tests for the payroll DRIFT comparison core (`diffDriftValues`).
 *
 * `computePayrollDrift` compares each payroll batch record's frozen snapshot
 * against a fresh recompute of the current source data and reports the
 * per-field differences. This pins the pure comparison logic — the epsilon
 * tolerance, hours-vs-currency fields, and the "source could not be recomputed"
 * (current === null) case — so the drift detector never silently misses or
 * over-reports a change.
 *
 * Run with: `tsx server/__tests__/payrollDrift.test.ts`
 */
import assert from "node:assert/strict";

const { diffDriftValues } = await import("../services/reconciliation.js");

type Values = {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  ptoHours: number;
  bonusHours: number;
  bonusAmount: number;
};

const zero: Values = {
  regularHours: 0,
  overtimeHours: 0,
  doubleTimeHours: 0,
  ptoHours: 0,
  bonusHours: 0,
  bonusAmount: 0,
};

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
}

// --- identical values => no drift ---
check("identical snapshot/current produces no changes", () => {
  const v: Values = { ...zero, regularHours: 8, overtimeHours: 2, bonusAmount: 25 };
  assert.equal(diffDriftValues(v, v).length, 0);
});

// --- sub-epsilon difference is ignored ---
check("sub-epsilon hours difference is not flagged", () => {
  const snap: Values = { ...zero, regularHours: 8 };
  const curr: Values = { ...zero, regularHours: 8.004 };
  assert.equal(diffDriftValues(snap, curr).length, 0);
});

// --- real hours change is flagged ---
check("a real regular-hours change is flagged", () => {
  const snap: Values = { ...zero, regularHours: 8 };
  const curr: Values = { ...zero, regularHours: 7.5 };
  const changes = diffDriftValues(snap, curr);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "regularHours");
  assert.equal(changes[0].snapshot, 8);
  assert.equal(changes[0].current, 7.5);
});

// --- multiple fields drift independently ---
check("multiple drifted fields each reported", () => {
  const snap: Values = { ...zero, regularHours: 8, overtimeHours: 2, ptoHours: 0, bonusAmount: 25 };
  const curr: Values = { ...zero, regularHours: 6, overtimeHours: 4, ptoHours: 0, bonusAmount: 25 };
  const fields = diffDriftValues(snap, curr).map((c) => c.field).sort();
  assert.deepEqual(fields, ["overtimeHours", "regularHours"]);
});

// --- bonus amount uses cents epsilon (penny change flagged) ---
check("a one-cent bonus change is flagged", () => {
  const snap: Values = { ...zero, bonusAmount: 25.0 };
  const curr: Values = { ...zero, bonusAmount: 25.01 };
  const changes = diffDriftValues(snap, curr);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "bonusAmount");
});

// --- current === null with non-zero snapshot => every non-zero field drifts ---
check("uncomputable source flags every non-zero snapshot field with null current", () => {
  const snap: Values = { ...zero, ptoHours: 8 };
  const changes = diffDriftValues(snap, null);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "ptoHours");
  assert.equal(changes[0].snapshot, 8);
  assert.equal(changes[0].current, null);
});

// --- current === null with all-zero snapshot => nothing to report ---
check("uncomputable source with all-zero snapshot reports nothing", () => {
  assert.equal(diffDriftValues(zero, null).length, 0);
});

console.log(`payrollDrift: ${passed} checks passed`);
