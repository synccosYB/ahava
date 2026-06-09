/**
 * Verifies the per-category report storage helpers added for "Make each report
 * tab show its own distinct report" return distinct, correctly-scoped data:
 *   - getTimeOffRequestsByDateRange (PTO)        — honors status + excludes cashout
 *   - getIncompletePunchesByDateRange (Missing)  — clock-in with no clock-out only
 *   - getAttendanceExceptionsByDateRange (Excep) — date-range + status scoped
 *
 * Run with: `tsx server/__tests__/reportCategories.test.ts`
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");
const { eq, inArray } = await import("drizzle-orm");

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const startDate = "2026-03-02";
const endDate = "2026-03-08";

async function makeEmployee(suffix: string) {
  const id = `rc-${suffix}-${stamp}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Cat",
    lastName: suffix,
    role: "employee",
    status: "active",
  });
  return id;
}

function ts(date: string, time: string) {
  return new Date(`${date}T${time}`);
}

const empA = await makeEmployee("a");
const empB = await makeEmployee("b");
const ids = [empA, empB];

try {
  // --- Time off fixtures ---
  await db.insert(schema.timeOffRequests).values([
    { userId: empA, type: "vacation", requestCategory: "time_off", startDate: "2026-03-03", endDate: "2026-03-04", status: "approved", hoursRequested: 16 },
    { userId: empA, type: "sick", requestCategory: "time_off", startDate: "2026-03-05", endDate: "2026-03-05", status: "pending", hoursRequested: 8 },
    // cashout must be excluded from the PTO report
    { userId: empB, type: "vacation", requestCategory: "cashout", startDate: "2026-03-06", endDate: "2026-03-06", status: "approved", hoursRequested: 8 },
    // outside the range — excluded
    { userId: empB, type: "vacation", requestCategory: "time_off", startDate: "2026-04-01", endDate: "2026-04-02", status: "approved", hoursRequested: 16 },
  ]);

  const ptoAll = await storage.getTimeOffRequestsByDateRange(startDate, endDate, ids);
  assert.equal(ptoAll.length, 2, "PTO: 2 in-range time_off requests (cashout + out-of-range excluded)");
  assert.ok(ptoAll.every((r) => r.requestCategory !== "cashout"), "PTO: cashouts excluded");

  const ptoApproved = await storage.getTimeOffRequestsByDateRange(startDate, endDate, ids, "approved");
  assert.equal(ptoApproved.length, 1, "PTO: status=approved narrows to 1");
  assert.equal(ptoApproved[0].userId, empA, "PTO: approved request belongs to empA");

  // --- Punch fixtures ---
  // empA: one complete day, one incomplete (no clock-out)
  await storage.createPunchLog({ employeeId: empA, workDate: "2026-03-02", clockIn: ts("2026-03-02", "09:00:00"), clockOut: ts("2026-03-02", "17:00:00"), status: "present" });
  await storage.createPunchLog({ employeeId: empA, workDate: "2026-03-03", clockIn: ts("2026-03-03", "09:00:00"), status: "in-progress" });
  // empB: incomplete punch outside range — excluded
  await storage.createPunchLog({ employeeId: empB, workDate: "2026-04-10", clockIn: ts("2026-04-10", "09:00:00"), status: "in-progress" });

  const missing = await storage.getIncompletePunchesByDateRange(startDate, endDate, ids);
  assert.equal(missing.length, 1, "Missing: only the in-range incomplete punch");
  assert.equal(missing[0].employeeId, empA, "Missing: belongs to empA");
  assert.equal(missing[0].clockOut, null, "Missing: has no clock-out");

  // --- Exception fixtures ---
  await db.insert(schema.attendanceExceptions).values([
    { employeeId: empA, exceptionDate: "2026-03-04", type: "missing_punch", reason: "forgot", status: "pending" },
    { employeeId: empB, exceptionDate: "2026-03-06", type: "time_correction", reason: "wrong time", status: "approved" },
    // outside range — excluded
    { employeeId: empB, exceptionDate: "2026-05-01", type: "missing_punch", reason: "later", status: "pending" },
  ]);

  const excAll = await storage.getAttendanceExceptionsByDateRange(startDate, endDate, ids);
  assert.equal(excAll.length, 2, "Exceptions: 2 in-range (out-of-range excluded)");

  const excApproved = await storage.getAttendanceExceptionsByDateRange(startDate, endDate, ids, "approved");
  assert.equal(excApproved.length, 1, "Exceptions: status=approved narrows to 1");
  assert.equal(excApproved[0].employeeId, empB, "Exceptions: approved belongs to empB");

  // Empty user set short-circuits for all three.
  assert.equal((await storage.getTimeOffRequestsByDateRange(startDate, endDate, [])).length, 0, "PTO: empty users -> []");
  assert.equal((await storage.getIncompletePunchesByDateRange(startDate, endDate, [])).length, 0, "Missing: empty users -> []");
  assert.equal((await storage.getAttendanceExceptionsByDateRange(startDate, endDate, [])).length, 0, "Exceptions: empty users -> []");

  console.log("✓ reportCategories: all assertions passed");
} finally {
  await db.delete(schema.attendanceExceptions).where(inArray(schema.attendanceExceptions.employeeId, ids));
  await db.delete(schema.timeOffRequests).where(inArray(schema.timeOffRequests.userId, ids));
  await db.delete(schema.punchLogs).where(inArray(schema.punchLogs.employeeId, ids));
  for (const id of ids) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

process.exit(0);
