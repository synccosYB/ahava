/**
 * Resilience: one malformed/corrupt punch must NEVER blank the whole timesheet.
 * A single day that throws while building is caught, logged, and surfaced as a
 * flagged "error" row — every other day in the range still renders normally.
 *
 * This reproduces the real-world symptom where an older employee's timesheet
 * failed to load over long ranges (past month / 3 months / 12 months) because a
 * single legacy record in that window crashed the build. The corrupt record here
 * is a far-future timestamp (valid in Postgres, beyond JS `Date`'s range) that
 * reads back as an Invalid Date — the same class of failure.
 *
 * Run with: `npx tsx server/__tests__/timesheetBadDay.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceLedger } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const BAD_DATE = "2025-06-16";  // Monday — gets a corrupt punch
const GOOD_DATE = "2025-06-17"; // Tuesday — a normal completed shift
const stamp = `badday-${Date.now().toString(36)}`;

async function makeEmployee() {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Bad", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  return emp.id;
}
async function cleanup(id: string) {
  await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, id)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
  await db.delete(users).where(eq(users.id, id)).catch(() => {});
}

test("one corrupt day is flagged, not fatal — the rest of the range still loads", async (t) => {
  const id = await makeEmployee();
  t.after(() => cleanup(id));

  // A normal completed shift on the GOOD day.
  await storage.createPunchLog({
    employeeId: id, workDate: GOOD_DATE,
    clockIn: new Date(`${GOOD_DATE}T09:00:00Z`), clockOut: new Date(`${GOOD_DATE}T17:00:00Z`),
    hoursWorked: 8, status: "completed", source: "manager", approved: true,
  });
  // A corrupt punch on the BAD day: a far-future timestamp that is valid in
  // Postgres but reads back as an Invalid Date in JS (raw insert — the ORM path
  // would reject an Invalid Date). Building this day throws without the guard.
  await db.execute(
    `INSERT INTO punch_logs (employee_id, work_date, clock_in, clock_out, hours_worked, status, source)
     VALUES ('${id}', '${BAD_DATE}', '280000-06-16 09:00:00', '280000-06-16 17:00:00', 8, 'completed', 'web')` as any,
  );

  // The whole range must build without throwing.
  const result = await buildEmployeeTimesheet((await storage.getUser(id))!, BAD_DATE, GOOD_DATE);

  const badDay = result.entries.find((e) => e.date === BAD_DATE);
  const goodDay = result.entries.find((e) => e.date === GOOD_DATE);

  assert.ok(badDay, "the corrupt day still produces a row");
  assert.equal(badDay!.status, "error", "the corrupt day is flagged as an error, not dropped");

  assert.ok(goodDay, "the good day is present");
  assert.equal(goodDay!.status, "complete", "the good day builds normally");
  assert.equal(goodDay!.totalHours, 8, "the good day's hours are intact");
});
