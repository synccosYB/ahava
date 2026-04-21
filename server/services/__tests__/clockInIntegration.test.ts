import { test } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../../storage";
import { db } from "../../db";
import { punchLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const TEST_USER_ID = "admin-dev-001";

async function cleanupTestPunches() {
  await db.delete(punchLogs).where(
    and(
      eq(punchLogs.employeeId, TEST_USER_ID),
      eq(punchLogs.source, "test"),
    ),
  );
}

test("storage.clockIn persists actual punch time and rounded time separately", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // Simulate a 12:07 PM punch with policy rounding to 12:00 PM
  const beforeMs = Date.now();
  const roundedTime = new Date(2026, 3, 21, 12, 0, 0, 0); // arbitrary rounded value

  const record = await storage.clockIn(TEST_USER_ID, "test", roundedTime);
  const afterMs = Date.now();

  assert.ok(record.clockIn, "clockIn should be set");
  assert.ok(record.roundedClockIn, "roundedClockIn should be set");

  const actualMs = new Date(record.clockIn!).getTime();
  // The stored clockIn is the actual moment (between beforeMs and afterMs),
  // not the rounded value passed in.
  assert.ok(
    actualMs >= beforeMs && actualMs <= afterMs,
    `clockIn (${actualMs}) should be the real punch moment, between ${beforeMs} and ${afterMs}`,
  );
  assert.equal(
    new Date(record.roundedClockIn!).getTime(),
    roundedTime.getTime(),
    "roundedClockIn should equal the rounded value supplied by the policy",
  );

  // The real punch moment must NOT match the rounded value (since rounded is
  // a fixed 12:00 PM in 2026 and the real moment is "now").
  assert.notEqual(
    actualMs,
    roundedTime.getTime(),
    "clockIn should not be overwritten with the rounded value",
  );
});

test("attendance status returns the actual clock-in time, not the rounded one", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  const roundedTime = new Date(2026, 3, 21, 12, 0, 0, 0);
  const created = await storage.clockIn(TEST_USER_ID, "test", roundedTime);

  const current = await storage.getCurrentAttendance(TEST_USER_ID);
  assert.ok(current, "current attendance should be returned");
  assert.equal(
    new Date(current!.clockIn!).getTime(),
    new Date(created.clockIn!).getTime(),
    "getCurrentAttendance should return the actual clock-in time",
  );
  assert.notEqual(
    new Date(current!.clockIn!).getTime(),
    roundedTime.getTime(),
    "getCurrentAttendance should not return the rounded clock-in time",
  );
});

test("clockOut hours are computed from the rounded clock-in (payroll math still rounds)", async (t) => {
  await cleanupTestPunches();
  t.after(cleanupTestPunches);

  // Insert an in-progress punch where actual clockIn = ~5h 7m ago and rounded
  // clockIn = exactly 5h ago (e.g. nearest-15-min rounding).
  const now = Date.now();
  const actualClockIn = new Date(now - (5 * 60 + 7) * 60 * 1000);
  const roundedClockIn = new Date(now - 5 * 60 * 60 * 1000);
  const dateStr = actualClockIn.toISOString().split("T")[0];

  const [inserted] = await db
    .insert(punchLogs)
    .values({
      employeeId: TEST_USER_ID,
      workDate: dateStr,
      clockIn: actualClockIn,
      roundedClockIn,
      status: "in-progress",
      source: "test",
      approved: true,
    })
    .returning();
  assert.ok(inserted);

  const result = await storage.clockOut(TEST_USER_ID);
  assert.ok(result, "clockOut should return a record");
  // hoursWorked is derived from rounded clock-in to "now". Allow small drift
  // for the few ms between Date.now() in test setup and inside clockOut.
  assert.ok(
    result!.hoursWorked! >= 4.99 && result!.hoursWorked! <= 5.02,
    `expected hoursWorked ~5.0 (computed from rounded clock-in), got ${result!.hoursWorked}`,
  );
});
