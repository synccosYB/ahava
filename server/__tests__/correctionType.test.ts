/**
 * Pure mapping from an employee's explicit correction choice (missing vs fix,
 * In vs Out) to the stored exception type. No DB.
 *
 * Run with: `npx tsx server/__tests__/correctionType.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCorrection, correctionTimeLabel } from "@shared/correctionType";

test("classifyCorrection: fixing an existing punch is always a one-sided time_correction", () => {
  assert.equal(classifyCorrection({ requestType: "fix", side: "in", hasExistingPunch: true }), "time_correction");
  assert.equal(classifyCorrection({ requestType: "fix", side: "out", hasExistingPunch: true }), "time_correction");
});

test("classifyCorrection: missing OUT on an existing punch closes it (forgotten_clock_out)", () => {
  assert.equal(classifyCorrection({ requestType: "missing", side: "out", hasExistingPunch: true }), "forgotten_clock_out");
});

test("classifyCorrection: missing IN on an existing punch updates it in place (time_correction, no duplicate insert)", () => {
  assert.equal(classifyCorrection({ requestType: "missing", side: "in", hasExistingPunch: true }), "time_correction");
});

test("classifyCorrection: missing punch with no existing punch -> missing_punch (insert)", () => {
  assert.equal(classifyCorrection({ requestType: "missing", side: "in", hasExistingPunch: false }), "missing_punch");
  assert.equal(classifyCorrection({ requestType: "missing", side: "out", hasExistingPunch: false }), "missing_punch");
});

test("correctionTimeLabel reflects the choice", () => {
  assert.match(correctionTimeLabel("missing", "out"), /Clock Out/);
  assert.match(correctionTimeLabel("fix", "in"), /Corrected Clock In/);
});
