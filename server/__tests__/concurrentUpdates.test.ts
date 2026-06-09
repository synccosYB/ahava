/**
 * Concurrency guards for PTO balances & approvals (task #316).
 *
 * Verifies two race-safety properties:
 *   1. PTO balance writes are atomic increments — two concurrent accrual /
 *      manual deltas both apply (final = sum of both), instead of one
 *      read-modify-write clobbering the other.
 *   2. Status-guarded approval transitions (`WHERE status = 'pending'`) let only
 *      ONE of two concurrent approvers win; the loser's update affects 0 rows
 *      and is treated as "already handled" rather than re-applying.
 *
 * Run with: `tsx server/__tests__/concurrentUpdates.test.ts`
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

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

const userId = await makeUser("concurrency");
const createdBalanceIds: string[] = [];
const createdExceptionIds: string[] = [];

try {
  // --- Case 1: atomic balance increments don't clobber each other ---
  const balance = await storage.createTimeOffBalance({
    userId,
    type: "vacation",
    year: 2099,
    totalHours: 100,
    usedHours: 0,
  });
  createdBalanceIds.push(balance.id);

  // Two concurrent deltas applied to the same row. With atomic SQL increments
  // both must land; a read-modify-write would lose one (final 108 or 105).
  await Promise.all([
    storage.incrementTimeOffBalance(balance.id, { totalHoursDelta: 8 }),
    storage.incrementTimeOffBalance(balance.id, { totalHoursDelta: 5 }),
  ]);

  const reloaded = await storage.getTimeOffBalanceById(balance.id);
  assert.equal(
    reloaded?.totalHours,
    113,
    `Concurrent increments must sum (100 + 8 + 5 = 113), got ${reloaded?.totalHours}`,
  );

  // Decrement path (e.g. usage) also applies atomically.
  await Promise.all([
    storage.incrementTimeOffBalance(balance.id, { usedHoursDelta: 3 }),
    storage.incrementTimeOffBalance(balance.id, { usedHoursDelta: 4 }),
  ]);
  const reloaded2 = await storage.getTimeOffBalanceById(balance.id);
  assert.equal(reloaded2?.usedHours, 7, `Concurrent usedHours increments must sum to 7, got ${reloaded2?.usedHours}`);

  // --- Case 2: double-approve of one exception — exactly one winner ---
  const exception = await storage.createAttendanceException({
    employeeId: userId,
    exceptionDate: "2099-01-15",
    type: "missing_punch",
    reason: "concurrency test",
    status: "pending",
  });
  createdExceptionIds.push(exception.id);

  // Two reviewers resolve the same pending exception at once. The guarded
  // UPDATE mirrors the route's `WHERE id = ? AND status = 'pending'`.
  const guardedResolve = (status: "approved" | "denied") =>
    db
      .update(schema.attendanceExceptions)
      .set({ status, reviewedAt: new Date() })
      .where(
        and(
          eq(schema.attendanceExceptions.id, exception.id),
          eq(schema.attendanceExceptions.status, "pending"),
        ),
      )
      .returning();

  const [resA, resB] = await Promise.all([
    guardedResolve("approved"),
    guardedResolve("denied"),
  ]);

  const winners = [resA, resB].filter((r) => r.length === 1).length;
  const losers = [resA, resB].filter((r) => r.length === 0).length;
  assert.equal(winners, 1, `Exactly one concurrent approve/deny must win, got ${winners} winners`);
  assert.equal(losers, 1, `Exactly one concurrent approve/deny must be rejected as already-handled, got ${losers} losers`);

  // Final row is in a resolved (non-pending) state, applied exactly once.
  const finalEx = await storage.getAttendanceException(exception.id);
  assert.notEqual(finalEx?.status, "pending", "Exception must end in a resolved state");
  assert.ok(
    finalEx?.status === "approved" || finalEx?.status === "denied",
    `Exception must be approved or denied, got ${finalEx?.status}`,
  );

  // A subsequent guarded resolve (a third late click) affects 0 rows.
  const late = await guardedResolve("approved");
  assert.equal(late.length, 0, "A late guarded resolve on an already-handled exception must affect 0 rows");

  console.log("OK — atomic balance increments and status-guarded approvals are race-safe.");
} finally {
  for (const id of createdExceptionIds) {
    try { await db.delete(schema.attendanceExceptions).where(eq(schema.attendanceExceptions.id, id)); } catch {}
  }
  for (const id of createdBalanceIds) {
    try { await db.delete(schema.timeOffBalances).where(eq(schema.timeOffBalances.id, id)); } catch {}
  }
  try { await db.delete(schema.users).where(eq(schema.users.id, userId)); } catch {}
}

process.exit(0);
