/**
 * A marked missing-clock-out punch must show a BLANK clock-out on the timesheet
 * (its stored clock-out is only a placeholder that frees the one-open-punch
 * slot). The day still reads status "missing_punch".
 *
 * Run with: `npx tsx server/__tests__/missingPunchTimesheet.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const stamp = `mpts-${Date.now().toString(36)}`;
let employeeId = "";

async function cleanup() {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("missing-clock-out day shows a blank clock-out but keeps the missing_punch status", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "MP", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // A forgotten punch-out, already marked: clock-in 9:00, placeholder clock-out
  // at the 13h mark, hours 0, status missing_clockout.
  const cin = new Date("2026-11-03T14:00:00Z");
  const placeholder = new Date(cin.getTime() + 13 * 3600 * 1000);
  await storage.createPunchLog({
    employeeId, workDate: "2026-11-03", clockIn: cin, clockOut: placeholder,
    roundedClockIn: cin, roundedClockOut: placeholder,
    hoursWorked: 0, status: "missing_clockout", source: "biometric", approved: true,
  });

  const sheet = await buildEmployeeTimesheet(emp as any, "2026-11-03", "2026-11-03");
  const day = sheet.entries.find((e) => e.date === "2026-11-03");
  assert.ok(day, "the day is present");
  assert.ok(day!.clockIn, "clock-in is shown");
  assert.equal(day!.clockOut, null, "clock-out is BLANK (placeholder not shown)");
  assert.equal(day!.status, "missing_punch", "still flagged as a missing punch");
});
