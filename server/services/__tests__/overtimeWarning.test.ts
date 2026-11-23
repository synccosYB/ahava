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
import { users, punchLogs, systemAlerts, companies } from "@shared/schema";
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

// The seed creates no company, so on a clean CI database there is no operational
// company yet. Create one when absent (and report so the caller can clean up),
// since getOperationalCompany is what the lead-margin setting lives on.
async function ensureOperationalCompany() {
  const existing = await storage.getOperationalCompany();
  if (existing) return { op: existing, created: false };
  const op = await storage.createCompany({ name: "Ahava Medical Center" });
  return { op, created: true };
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

test("the warning lead margin is configurable on the operational company", async (t) => {
  // 39:40 sits UNDER the default 39:45 warn point (lead 15) but OVER a 39:30
  // warn point (lead 30), so widening the company's lead to 30 is what makes
  // this employee warn — proving the stored setting drives the warn point.
  const { op, created } = await ensureOperationalCompany();
  const originalLead = op.overtimeWarningLeadMinutes ?? 15;

  const id = await makeEmployee("lead");
  t.after(async () => {
    if (created) await db.delete(companies).where(eq(companies.id, op.id)).catch(() => {});
    else await storage.updateCompany(op.id, { overtimeWarningLeadMinutes: originalLead }).catch(() => {});
    await cleanupEmployee(id);
  });

  await addHoursToday(id, 39.67); // 39h 40m

  // Default lead (15 → warn at 39:45): 39:40 is under, so no warning.
  await storage.updateCompany(op!.id, { overtimeWarningLeadMinutes: 15 });
  await runApproachingOvertimeWarnings();
  let alerts = await db.select().from(systemAlerts).where(eq(systemAlerts.employeeId, id));
  assert.equal(alerts.length, 0, "with a 15-min lead, 39:40 is not yet warned");

  // Widen to 30 (→ warn at 39:30): now 39:40 crosses the warn point.
  await storage.updateCompany(op!.id, { overtimeWarningLeadMinutes: 30 });
  await runApproachingOvertimeWarnings();
  alerts = await db.select().from(systemAlerts).where(eq(systemAlerts.employeeId, id));
  assert.equal(alerts.length, 1, "with a 30-min lead, 39:40 is warned");
  assert.equal((alerts[0].details as any).leadMinutes, 30, "alert records the configured lead");
});
