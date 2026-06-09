import { test } from "node:test";
import assert from "node:assert/strict";
import { storage, DuplicateOpenPunchError } from "../../storage";
import { db } from "../../db";
import { punchLogs } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

const TEST_USER_ID = "admin-dev-001";

async function cleanupTestPunches() {
  await db.delete(punchLogs).where(
    and(
      eq(punchLogs.employeeId, TEST_USER_ID),
      eq(punchLogs.source, "test"),
    ),
  );
}

async function countOpenPunches(): Promise<number> {
  const rows = await db
    .select({ id: punchLogs.id })
    .from(punchLogs)
    .where(and(eq(punchLogs.employeeId, TEST_USER_ID), isNull(punchLogs.clockOut)));
  return rows.length;
}

test("two concurrent clock-ins leave exactly one open punch", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // Fire two clock-ins for the same user at the same time. Exactly one must
  // succeed; the other must be rejected as a duplicate open punch.
  const results = await Promise.allSettled([
    storage.clockIn(TEST_USER_ID, "test"),
    storage.clockIn(TEST_USER_ID, "test"),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "exactly one clock-in should succeed");
  assert.equal(rejected.length, 1, "exactly one clock-in should be rejected");
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof DuplicateOpenPunchError,
    "the losing clock-in should reject with DuplicateOpenPunchError",
  );

  assert.equal(await countOpenPunches(), 1, "only one open punch should exist");
});

test("a second clock-in while already open is rejected", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  await storage.clockIn(TEST_USER_ID, "test");
  await assert.rejects(
    () => storage.clockIn(TEST_USER_ID, "test"),
    (err: unknown) => err instanceof DuplicateOpenPunchError,
    "a second clock-in should throw DuplicateOpenPunchError",
  );

  assert.equal(await countOpenPunches(), 1, "still exactly one open punch");
});

test("double clock-out closes once and no-ops the second", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  await storage.clockIn(TEST_USER_ID, "test");

  const [first, second] = await Promise.all([
    storage.clockOut(TEST_USER_ID),
    storage.clockOut(TEST_USER_ID),
  ]);

  const closed = [first, second].filter(Boolean);
  assert.equal(closed.length, 1, "exactly one clock-out should close a punch");
  assert.equal(await countOpenPunches(), 0, "no open punches should remain");

  // A subsequent clock-out is a clean no-op (returns undefined), not an error.
  const third = await storage.clockOut(TEST_USER_ID);
  assert.equal(third, undefined, "clocking out again should be a no-op");
});

test("clock-in is allowed again after clocking out", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  await storage.clockIn(TEST_USER_ID, "test");
  await storage.clockOut(TEST_USER_ID);

  // Closing the open punch frees the partial unique index so the next shift
  // can start cleanly.
  await assert.doesNotReject(() => storage.clockIn(TEST_USER_ID, "test"));
  assert.equal(await countOpenPunches(), 1, "exactly one open punch after re-clock-in");
});
