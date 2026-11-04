/**
 * Approaching-weekly-overtime warning: when an employee's running weekly worked
 * hours reach the lead margin below the weekly OT threshold (default 15m → 39:45
 * for a 40h threshold), a one-per-week `overtime_warning` alert is raised (and
 * the owner + managers are emailed). An employee comfortably under is left alone.
 *
 * Run with: `npx tsx server/services/__tests__/overtimeWarning.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { users, punchLogs, systemAlerts } from "@shared/schema";
import { runApproachingOvertimeWarnings } from "../overtimeWarning";

const stamp = `otw-${Date.now().toString(36)}`;
const today = new Date().toISOString().split("T")[0];

async function makeEmployee(suffix: string) {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-${suffix}@example.invalid`, firstName: "OT", lastName: `${stamp}${suffix}`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  return emp.id;
}
async function cleanupEmployee(id: string) {
  await db.delete(systemAlerts).where(eq(systemAlerts.employeeId, id)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
  await db.delete(users).where(eq(users.id, id)).catch(() => {});
}

// A completed punch today carrying a fixed worked-hours value (the SQL weekly
// sum uses stored hours_worked when present), so the weekly total is exact.
async function addHoursToday(employeeId: string, hours: number) {
  const cin = new Date(`${today}T08:00:00Z`);
  const cout = new Date(cin.getTime() + hours * 3600 * 1000);
  await storage.createPunchLog({
    employeeId, workDate: today, clockIn: cin, clockOut: cout,
    hoursWorked: hours, status: "completed", source: "manager", approved: true,
  });
}

test("an employee at 39:50 for the week triggers a one-per-week overtime warning", async (t) => {
  const id = await makeEmployee("near");
  t.after(() => cleanupEmployee(id));

  await addHoursToday(id, 39.83); // 39h 50m — past the 39:45 warn point, under 40h

  const r1 = await runApproachingOvertimeWarnings();
  assert.ok(r1.warned >= 1, "at least one employee warned");

  const alerts = await db.select().from(systemAlerts).where(eq(systemAlerts.employeeId, id));
  assert.equal(alerts.length, 1, "exactly one overtime_warning alert for the employee");
  assert.equal(alerts[0].type, "overtime_warning");
  assert.equal((alerts[0].details as any).threshold, 40);

  // Idempotent within the same week — a second pass does not duplicate.
  await runApproachingOvertimeWarnings();
  const after = await db.select().from(systemAlerts).where(eq(systemAlerts.employeeId, id));
  assert.equal(after.length, 1, "no duplicate warning on a second pass");
});

test("an employee well under the threshold is not warned", async (t) => {
  const id = await makeEmployee("under");
  t.after(() => cleanupEmployee(id));

  await addHoursToday(id, 30);

  await runApproachingOvertimeWarnings();
  const alerts = await db.select().from(systemAlerts).where(eq(systemAlerts.employeeId, id));
  assert.equal(alerts.length, 0, "no warning under the threshold");
});
