/**
 * Exact time (no quarter-hour rounding). Worked hours must equal the actual
 * clocked span to the minute, and the 0081 migration must correct already-
 * recorded punches that were stored with 15-min rounding.
 *
 * The reported case: clock-in 9:11, clock-out 1:23 → 4h12m (4.2h), NOT the
 * rounded 4h15m (4.25h) it used to show.
 *
 * Run with: `npx tsx server/__tests__/exactTimeRounding.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { getLedgerForEmployee } from "../attendanceLedger";

const stamp = `exact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

test("migration corrects a rounded punch to exact time, and the ledger total matches", async (t) => {
  const [company] = await db.insert(schema.companies).values({ name: `Exact Co ${stamp}` }).returning();
  const [emp] = await db.insert(schema.users).values({
    email: `${stamp}@example.invalid`, firstName: "Exact", lastName: stamp, role: "employee", companyId: company.id,
  }).returning();

  // Simulate the OLD rounded state: real punch 9:11→1:23, but rounded 9:15→1:30
  // and hours stored as the rounded 4.25h.
  const clockIn = new Date("2026-11-06T09:11:00Z");
  const clockOut = new Date("2026-11-06T13:23:00Z");
  const roundedIn = new Date("2026-11-06T09:15:00Z");
  const roundedOut = new Date("2026-11-06T13:30:00Z");
  const [punch] = await db.insert(schema.punchLogs).values({
    employeeId: emp.id, workDate: "2026-11-06",
    clockIn, clockOut, roundedClockIn: roundedIn, roundedClockOut: roundedOut,
    hoursWorked: 4.25, status: "complete", source: "manual", approved: true,
  }).returning();

  t.after(async () => {
    await db.delete(schema.punchLogs).where(eq(schema.punchLogs.employeeId, emp.id)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, emp.id)).catch(() => {});
    await db.delete(schema.companies).where(eq(schema.companies.id, company.id)).catch(() => {});
  });

  // Run the 0081 migration's UPDATE (the exact SQL shipped to production).
  const sql = fs.readFileSync(path.resolve("migrations/0081_exact_time_no_rounding.sql"), "utf-8");
  await db.execute(sql as any);

  // The punch now carries exact rounded times and exact hours (4.2h).
  const [fixed] = await db.select().from(schema.punchLogs).where(eq(schema.punchLogs.id, punch.id));
  assert.equal(new Date(fixed.roundedClockIn as any).getTime(), clockIn.getTime(), "rounded in == actual in");
  assert.equal(new Date(fixed.roundedClockOut as any).getTime(), clockOut.getTime(), "rounded out == actual out");
  assert.equal(Number(fixed.hoursWorked), 4.2, `hours should be exact 4.2, got ${fixed.hoursWorked}`);

  // The ledger (what the timesheet/report/payroll shows) recomputes to 4.2h.
  const ledger = await getLedgerForEmployee(emp as any, "2026-11-06", "2026-11-06");
  const day = ledger.find((d) => d.workDate === "2026-11-06");
  assert.ok(day, "ledger day present");
  assert.equal(day!.totalHours, 4.2, `ledger total should be 4.2h, got ${day!.totalHours}`);
});
