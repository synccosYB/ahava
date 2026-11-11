/**
 * The employee timesheet surfaces the day-of-week bonus money earned in a range
 * (e.g. a $20 Sunday bonus), so the "Bonuses this period" stat matches what the
 * payroll report pays. Scenario (the owner's report): an employee with a $20
 * Sunday bonus who works 2 Sundays → $40 total; a Monday earns nothing.
 *
 * Run with: `npx tsx server/__tests__/timesheetBonusTotal.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, userEmploymentProfiles } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const stamp = `tsbonus-${Date.now().toString(36)}`;
let employeeId = "";

async function cleanup() {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

// 2026-11-08 and 2026-11-15 are Sundays; 2026-11-09 is a Monday.
const punch = (workDate: string) => {
  const clockIn = new Date(`${workDate}T09:00:00Z`);
  const clockOut = new Date(`${workDate}T17:00:00Z`);
  return {
    employeeId, workDate, clockIn, clockOut, roundedClockIn: clockIn, roundedClockOut: clockOut,
    hoursWorked: 8, status: "complete" as const, source: "manual" as const, approved: true,
  };
};

test("timesheet totals a $20 Sunday bonus over 2 worked Sundays to $40; a Monday adds nothing", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Abe", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // Employee-level Sunday bonus: $20 for any Sunday worked (threshold 0h).
  await db.insert(userEmploymentProfiles).values({
    userId: employeeId,
    dayOfWeekBonuses: [{ id: "sun", dayOfWeek: 0, minHoursThreshold: 0, bonusType: "money", bonusAmount: 20 }],
  });

  await storage.createPunchLog(punch("2026-11-08")); // Sunday
  await storage.createPunchLog(punch("2026-11-09")); // Monday (no bonus)
  await storage.createPunchLog(punch("2026-11-15")); // Sunday

  const sheet = await buildEmployeeTimesheet(emp as any, "2026-11-08", "2026-11-15");

  assert.equal(sheet.totals.totalBonus, 40, `two $20 Sundays should total $40, got ${sheet.totals.totalBonus}`);
  assert.equal(sheet.entries.find((e) => e.date === "2026-11-08")?.bonusAmount, 20);
  assert.equal(sheet.entries.find((e) => e.date === "2026-11-15")?.bonusAmount, 20);
  assert.equal(sheet.entries.find((e) => e.date === "2026-11-09")?.bonusAmount, 0, "Monday earns no Sunday bonus");
});
