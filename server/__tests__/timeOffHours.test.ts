/**
 * Regression tests for task #230 — the PTO balance card was rendering
 * scientific-notation values like `4.25e+37` because a corrupt
 * `hours_requested`/`hours_approved` row was poisoning the balance reducer.
 *
 * Run with: `tsx server/__tests__/timeOffHours.test.ts`
 */
import assert from "node:assert/strict";

const {
  isSaneTimeOffHours,
  MAX_TIME_OFF_HOURS_PER_REQUEST,
} = await import("../../shared/schema.js");

// --- isSaneTimeOffHours ---
assert.equal(isSaneTimeOffHours(8), true, "8 hours is sane");
assert.equal(isSaneTimeOffHours(40), true, "40 hours is sane");
assert.equal(isSaneTimeOffHours(MAX_TIME_OFF_HOURS_PER_REQUEST), true, "cap is sane");
assert.equal(isSaneTimeOffHours(0), false, "zero is rejected");
assert.equal(isSaneTimeOffHours(-8), false, "negative is rejected");
assert.equal(isSaneTimeOffHours(NaN), false, "NaN is rejected");
assert.equal(isSaneTimeOffHours(Infinity), false, "Infinity is rejected");
assert.equal(isSaneTimeOffHours(-Infinity), false, "-Infinity is rejected");
assert.equal(isSaneTimeOffHours(4.2535296e37), false, "the screenshot value is rejected");
assert.equal(isSaneTimeOffHours(MAX_TIME_OFF_HOURS_PER_REQUEST + 1), false, "above cap is rejected");
assert.equal(isSaneTimeOffHours("8" as unknown), false, "non-number is rejected");
assert.equal(isSaneTimeOffHours(null as unknown), false, "null is rejected");

// --- Balance reducer behavior ---
// Mirrors the in-storage reducer in `computeTimeOffBalanceDetailed`.
// If a corrupt row sneaks back in, the visible totals must stay finite.
type Row = {
  id: string;
  userId: string;
  type: "vacation" | "sick" | "personal";
  status: string;
  hoursApproved: number | null;
  hoursRequested: number | null;
};

function computeUsed(rows: Row[]): { vacation: number; sick: number; personal: number } {
  let vacation = 0,
    sick = 0,
    personal = 0;
  for (const r of rows) {
    if (r.status !== "approved" && r.status !== "partially_approved") continue;
    const rawHours = r.hoursApproved ?? r.hoursRequested ?? 8;
    if (!isSaneTimeOffHours(rawHours)) continue; // defense-in-depth
    if (r.type === "vacation") vacation += rawHours;
    else if (r.type === "sick") sick += rawHours;
    else if (r.type === "personal") personal += rawHours;
  }
  return { vacation, sick, personal };
}

const corruptValue = 4.2535296e37;
const used = computeUsed([
  { id: "1", userId: "u", type: "personal", status: "approved", hoursApproved: null, hoursRequested: 8 },
  { id: "2", userId: "u", type: "personal", status: "approved", hoursApproved: corruptValue, hoursRequested: corruptValue },
  { id: "3", userId: "u", type: "vacation", status: "approved", hoursApproved: 16, hoursRequested: 16 },
  { id: "4", userId: "u", type: "sick", status: "pending", hoursApproved: null, hoursRequested: 8 },
  { id: "5", userId: "u", type: "sick", status: "approved", hoursApproved: null, hoursRequested: Infinity },
]);

assert.ok(Number.isFinite(used.personal), "personal stays finite even with a poisoned row");
assert.ok(Number.isFinite(used.vacation), "vacation stays finite");
assert.ok(Number.isFinite(used.sick), "sick stays finite");
assert.equal(used.personal, 8, "only the sane personal row counts");
assert.equal(used.vacation, 16, "vacation row counts normally");
assert.equal(used.sick, 0, "pending and Infinity sick rows are excluded");

const ANNUAL_PERSONAL = 40;
const remaining = ANNUAL_PERSONAL - used.personal;
assert.ok(Number.isFinite(remaining), "remaining balance never goes to scientific notation");
assert.equal(remaining, 32, "remaining matches expected 40 - 8");

console.log("OK — task #230 time-off hours regression tests passed");
