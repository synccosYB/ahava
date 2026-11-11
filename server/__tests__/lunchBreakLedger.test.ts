/**
 * Lunch-required employees: the per-employee toggle flows through the attendance
 * ledger. Proves the wiring (not just the pure math in services/lunchBreak):
 *   - clean lunch within the hour  -> full span paid (lunch paid up to 45)
 *   - clocked out, forgot to return -> one shift (first->last) minus a 45-min fine
 *
 * Run with: `npx tsx server/__tests__/lunchBreakLedger.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, punchLogs, userEmploymentProfiles } from "@shared/schema";
import { getLedgerForEmployee, getLedgerForEmployees } from "../attendanceLedger";
import { MISSING_CLOCKOUT_STATUS } from "../punchHours";

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: got ${a}, want ${b}`);
const D = (s: string) => new Date(s);

async function makeLunchEmployee(requireLunch: boolean) {
  const [u] = await db.insert(users).values({
    email: `lunch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    firstName: "Lunch", lastName: "Tester", role: "employee",
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: u.id, payType: "hourly", hourlyRate: 20, requireLunchBreak: requireLunch,
  });
  return u;
}
async function cleanup(id: string) {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
  await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id)).catch(() => {});
  await db.delete(users).where(eq(users.id, id)).catch(() => {});
}
const now = D("2026-11-06T23:00:00Z");

test("ledger: lunch-required clean lunch within the hour -> full span paid", async (t) => {
  const u = await makeLunchEmployee(true);
  t.after(() => cleanup(u.id));
  // in 9:03, lunch-out 12:15, back 12:59 (44m), out 17:00. hours_worked persisted.
  await db.insert(punchLogs).values([
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T09:03:00Z"), clockOut: D("2026-11-05T12:15:00Z"), roundedClockIn: D("2026-11-05T09:03:00Z"), roundedClockOut: D("2026-11-05T12:15:00Z"), hoursWorked: 3.2, status: "complete", approved: true },
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T12:59:00Z"), clockOut: D("2026-11-05T17:00:00Z"), roundedClockIn: D("2026-11-05T12:59:00Z"), roundedClockOut: D("2026-11-05T17:00:00Z"), hoursWorked: 4 + 1 / 60, status: "complete", approved: true },
  ]);
  const ledger = await getLedgerForEmployee(u, "2026-11-05", "2026-11-05", now);
  assert.deepEqual((await getLedgerForEmployees([u], "2026-11-05", "2026-11-05", now)).get(u.id), ledger, "bulk preserves lunch rules");
  const day = ledger.find((d) => d.workDate === "2026-11-05");
  assert.ok(day, "ledger day present");
  near(day!.totalHours, 17 - 9 - 3 / 60, "full span 9:03->17:00 (~7.95h)");
});

test("ledger: lunch-required forgot to clock back in -> span minus 45 fine", async (t) => {
  const u = await makeLunchEmployee(true);
  t.after(() => cleanup(u.id));
  // in 9:00, lunch-out 12:00 (3h), then a swept missing punch at 17:00.
  await db.insert(punchLogs).values([
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T09:00:00Z"), clockOut: D("2026-11-05T12:00:00Z"), roundedClockIn: D("2026-11-05T09:00:00Z"), roundedClockOut: D("2026-11-05T12:00:00Z"), hoursWorked: 3, status: "complete", approved: true },
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T17:00:00Z"), clockOut: D("2026-11-06T06:00:00Z"), roundedClockIn: D("2026-11-05T17:00:00Z"), hoursWorked: 0, status: MISSING_CLOCKOUT_STATUS, approved: true },
  ]);
  const ledger = await getLedgerForEmployee(u, "2026-11-05", "2026-11-05", now);
  assert.deepEqual((await getLedgerForEmployees([u], "2026-11-05", "2026-11-05", now)).get(u.id), ledger, "bulk preserves lunch rules");
  const day = ledger.find((d) => d.workDate === "2026-11-05");
  assert.ok(day, "ledger day present");
  near(day!.totalHours, 8 - 45 / 60, "span 9->17 (8h) - 45m fine (7.25h)");
});

test("ledger: NON-lunch employee is unaffected (no paid lunch, no fine)", async (t) => {
  const u = await makeLunchEmployee(false);
  t.after(() => cleanup(u.id));
  await db.insert(punchLogs).values([
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T09:00:00Z"), clockOut: D("2026-11-05T12:00:00Z"), roundedClockIn: D("2026-11-05T09:00:00Z"), roundedClockOut: D("2026-11-05T12:00:00Z"), hoursWorked: 3, status: "complete", approved: true },
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T13:00:00Z"), clockOut: D("2026-11-05T17:00:00Z"), roundedClockIn: D("2026-11-05T13:00:00Z"), roundedClockOut: D("2026-11-05T17:00:00Z"), hoursWorked: 4, status: "complete", approved: true },
  ]);
  const ledger = await getLedgerForEmployee(u, "2026-11-05", "2026-11-05", now);
  assert.deepEqual((await getLedgerForEmployees([u], "2026-11-05", "2026-11-05", now)).get(u.id), ledger, "bulk preserves lunch rules");
  const day = ledger.find((d) => d.workDate === "2026-11-05");
  assert.ok(day, "ledger day present");
  near(day!.totalHours, 7, "7h worked, lunch gap unpaid, no fine");
});
