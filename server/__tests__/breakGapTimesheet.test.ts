/**
 * At Ahava a lunch is taken by clocking OUT and back IN, so the timesheet's
 * "Break" for a day is the time clocked out BETWEEN punches (the gap from one
 * punch-out to the next punch-in), not the per-punch breakMinutes field.
 *
 * Scenario (the owner's report): in 9:00, out 12:30, in 1:00, out 5:15 — a
 * 30-minute lunch within the hour. The day must show breakMinutes = 30.
 *
 * Run with: `npx tsx server/__tests__/breakGapTimesheet.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const stamp = `brkgap-${Date.now().toString(36)}`;
let employeeId = "";

async function cleanup() {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("break = gap between punch-out and next punch-in (out-for-lunch day)", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Brk", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // Morning: 9:00 -> 12:30 (3.5h)
  const in1 = new Date("2026-11-08T09:00:00Z");
  const out1 = new Date("2026-11-08T12:30:00Z");
  await storage.createPunchLog({
    employeeId, workDate: "2026-11-08", clockIn: in1, clockOut: out1,
    roundedClockIn: in1, roundedClockOut: out1,
    hoursWorked: 3.5, status: "complete", source: "manual", approved: true,
  });
  // Afternoon: 1:00 -> 5:15 (4.25h), after a 30-min lunch.
  const in2 = new Date("2026-11-08T13:00:00Z");
  const out2 = new Date("2026-11-08T17:15:00Z");
  await storage.createPunchLog({
    employeeId, workDate: "2026-11-08", clockIn: in2, clockOut: out2,
    roundedClockIn: in2, roundedClockOut: out2,
    hoursWorked: 4.25, status: "complete", source: "manual", approved: true,
  });

  const sheet = await buildEmployeeTimesheet(emp as any, "2026-11-08", "2026-11-08");
  const day = sheet.entries.find((e) => e.date === "2026-11-08");
  assert.ok(day, "the day is present");
  assert.equal(day!.breakMinutes, 30, `break should be the 30-min gap, got ${day!.breakMinutes}`);
});
