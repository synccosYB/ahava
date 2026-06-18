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

// --- task #476: the 409 "already clocked in" guard and the open-punch /
// integrity definition must agree, regardless of the row's status value. -----

async function insertOpenPunch(status: string) {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const [row] = await db
    .insert(punchLogs)
    .values({
      employeeId: TEST_USER_ID,
      workDate: dateStr,
      clockIn: now,
      roundedClockIn: now,
      status,
      source: "test",
      approved: true,
    })
    .returning();
  return row;
}

test("getCurrentAttendance detects a kiosk open punch (status 'present')", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // The kiosk stamps open punches 'present', not 'in-progress'. The 409 guard
  // must still see them as open, or a web clock-in slips past it into a 400.
  await insertOpenPunch("present");

  const current = await storage.getCurrentAttendance(TEST_USER_ID);
  assert.ok(current, "a 'present' open punch must surface as currently clocked in");
  assert.equal(await countOpenPunches(), 1);
});

test("getCurrentAttendance detects a dangling open punch (non-open status)", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // A leftover row with clock_out NULL but a non-open status (e.g. from an
  // interrupted/auto clock-out). Previously invisible to the status-keyed 409
  // guard yet rejected by the integrity validator -> stuck state.
  await insertOpenPunch("complete");

  const current = await storage.getCurrentAttendance(TEST_USER_ID);
  assert.ok(current, "a dangling open punch must surface as currently clocked in");

  // The underlying clock-in detection agrees: it rejects rather than creating a
  // second open punch (the route turns this into a 409, never a silent pass).
  await assert.rejects(
    () => storage.clockIn(TEST_USER_ID, "test"),
    (err: unknown) => err instanceof DuplicateOpenPunchError,
    "clocking in over a dangling open punch must be rejected, not duplicated",
  );
  assert.equal(await countOpenPunches(), 1, "still exactly one open punch");
});

test("a dangling open punch can still be clocked out (no stuck state)", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // Make the open clock-in ~1h ago so clock-out yields positive hours.
  const clockInAt = new Date(Date.now() - 60 * 60 * 1000);
  const dateStr = clockInAt.toISOString().split("T")[0];
  await db.insert(punchLogs).values({
    employeeId: TEST_USER_ID,
    workDate: dateStr,
    clockIn: clockInAt,
    roundedClockIn: clockInAt,
    status: "complete", // dangling: open row with a non-open status
    source: "test",
    approved: true,
  });

  const closed = await storage.clockOut(TEST_USER_ID);
  assert.ok(closed, "a dangling open punch must be closable, not 'not clocked in'");
  assert.equal(await countOpenPunches(), 0, "no open punches remain after clock-out");
});
