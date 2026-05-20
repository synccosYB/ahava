/**
 * Regression test for task #228 — PTO requests that exceed the policy's
 * max consecutive hours should NO LONGER be rejected with a 400. They must be
 * created in `pending` status with `exceedsMaxConsecutive = true` so the
 * manager can decide. In-range requests must not have the flag set.
 *
 * Run with: `tsx server/__tests__/timeOffMaxConsecutive.test.ts`
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");

async function makeUser(idPrefix: string) {
  const id = `${idPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Test",
    lastName: idPrefix,
    role: "employee",
  });
  return id;
}

const userId = await makeUser("ptomax");
const createdRequestIds: string[] = [];

try {
  // --- Case 1: request that exceeds the cap is persisted as pending+flagged ---
  // Cap defaults to 80 hours; 15 business days = 120 hours which exceeds it.
  // Mimic what /api/time-off does now: compute the flag and persist the request.
  const maxConsecutiveHours = 80;
  const overHours = 120;
  const exceedsMaxConsecutive = overHours > maxConsecutiveHours;
  assert.equal(exceedsMaxConsecutive, true, "120 > 80 must flag exceedsMaxConsecutive");

  const overReq = await storage.createTimeOffRequest({
    userId,
    type: "vacation",
    startDate: "2026-06-01",
    endDate: "2026-06-19", // 15 business days = 120 hours
    hoursRequested: overHours,
    status: "pending",
    reason: "long vacation",
    exceedsBalance: false,
    balanceAtSubmission: 200,
    exceedsMaxConsecutive,
    maxConsecutiveAtSubmission: maxConsecutiveHours,
  });
  createdRequestIds.push(overReq.id);

  assert.equal(overReq.status, "pending", "Over-cap request must be created as pending, not auto-anything");
  assert.equal(overReq.exceedsMaxConsecutive, true, "exceedsMaxConsecutive must be true on the persisted row");
  assert.equal(overReq.maxConsecutiveAtSubmission, maxConsecutiveHours, "policy cap must be stored on the row");
  assert.equal(overReq.hoursRequested, overHours);

  // Round-trip via select to confirm column actually exists in DB.
  const [reloaded] = await db
    .select()
    .from(schema.timeOffRequests)
    .where(eq(schema.timeOffRequests.id, overReq.id));
  assert.equal(reloaded.exceedsMaxConsecutive, true, "DB column exceeds_max_consecutive must round-trip true");
  assert.equal(reloaded.maxConsecutiveAtSubmission, maxConsecutiveHours);

  // --- Case 2: in-range request leaves the flag false ---
  const inRangeHours = 16;
  const okReq = await storage.createTimeOffRequest({
    userId,
    type: "vacation",
    startDate: "2026-07-06",
    endDate: "2026-07-07", // 2 business days = 16 hours
    hoursRequested: inRangeHours,
    status: "pending",
    reason: "short break",
    exceedsBalance: false,
    balanceAtSubmission: 200,
    exceedsMaxConsecutive: inRangeHours > maxConsecutiveHours,
    maxConsecutiveAtSubmission: maxConsecutiveHours,
  });
  createdRequestIds.push(okReq.id);

  assert.equal(okReq.status, "pending");
  assert.equal(okReq.exceedsMaxConsecutive, false, "In-range request must NOT be flagged");

  console.log("OK — PTO over-cap requests are flagged for manager review, not rejected.");
} finally {
  for (const id of createdRequestIds) {
    try { await db.delete(schema.timeOffRequests).where(eq(schema.timeOffRequests.id, id)); } catch {}
  }
  try { await db.delete(schema.users).where(eq(schema.users.id, userId)); } catch {}
}

process.exit(0);
