/**
 * Long-range timesheet performance guard: a browsing range longer than ~6 weeks
 * ("Past 3 months", "This year", "Last 12 months") skips the heavy weekly-OT
 * ledger rebuild so it loads fast. Hours stay exact (summed from the per-day
 * rows); the OT split is omitted and `coarseHours` is set so the UI can say so.
 * A short range keeps the full ledger and exact OT.
 *
 * Run: `npx tsx server/__tests__/timesheetLongRange.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceLedger } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const WORK_DATE = "2025-06-17"; // one 8h shift
const stamp = `longrange-${Date.now().toString(36)}`;

test("long range skips the ledger (coarse, exact hours); short range keeps it", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Long", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  t.after(async () => {
    await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, emp.id)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, emp.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, emp.id)).catch(() => {});
  });

  await storage.createPunchLog({
    employeeId: emp.id, workDate: WORK_DATE,
    clockIn: new Date(`${WORK_DATE}T09:00:00Z`), clockOut: new Date(`${WORK_DATE}T17:00:00Z`),
    hoursWorked: 8, status: "completed", source: "manager", approved: true,
  });
  const user = (await storage.getUser(emp.id))!;

  // Short range (7 days) → full ledger, exact.
  const short = await buildEmployeeTimesheet(user, "2025-06-16", "2025-06-22");
  assert.ok(!short.coarseHours, "short range uses the ledger (not coarse)");
  assert.equal(short.totals.totalHours, 8, "short range total hours exact");
  assert.equal(short.totals.daysWorked, 1, "short range days worked");

  // Long range (~3 months, 92 days) → ledger skipped, hours still exact.
  const long = await buildEmployeeTimesheet(user, "2025-04-01", "2025-07-01");
  assert.equal(long.coarseHours, true, "long range is flagged coarse (ledger skipped)");
  assert.equal(long.totals.totalHours, 8, "long range total hours summed from the day rows");
  assert.equal(long.totals.overtimeHours, 0, "long range omits the OT split (shown as 0)");
  assert.equal(long.totals.daysWorked, 1, "long range counts the worked day");
  const day = long.entries.find((e) => e.date === WORK_DATE);
  assert.ok(day && day.totalHours === 8, "the worked day's hours render in the long view");
});
