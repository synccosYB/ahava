/**
 * "Merge into one shift" detection: a day that was split into a clock-in-only
 * punch AND a clock-out-only punch (the back-fill-while-open glitch) reads as a
 * Missing Punch and is flagged `canMerge` so the UI offers to combine them.
 * A day with only one half (just a clock-in) is NOT mergeable — it needs the
 * missing time entered — and a complete day is never mergeable.
 *
 * Run: `npx tsx server/__tests__/timesheetMergeDetect.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceLedger } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";
import { MISSING_CLOCKOUT_STATUS, MISSING_CLOCKIN_STATUS } from "../punchHours";

const SPLIT = "2025-06-17";    // clock-in-only + clock-out-only → mergeable
const HALF = "2025-06-18";     // clock-in-only → NOT mergeable
const WHOLE = "2025-06-19";    // complete shift → not mergeable
const STRAY = "2025-06-20";    // complete shift + leftover stray → canRemoveExtra
const stamp = `merge-${Date.now().toString(36)}`;

test("a split clock-in/clock-out day is flagged canMerge; a lone half and a complete day are not", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Split", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  t.after(async () => {
    await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, emp.id)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, emp.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, emp.id)).catch(() => {});
  });

  // SPLIT day: a clock-in-only punch (missing clock-out) + a separate clock-out-only punch.
  await db.insert(punchLogs).values({
    employeeId: emp.id, workDate: SPLIT,
    clockIn: new Date(`${SPLIT}T09:26:00Z`), clockOut: new Date(`${SPLIT}T09:26:00Z`),
    hoursWorked: 0, status: MISSING_CLOCKOUT_STATUS, source: "web",
  } as any);
  await db.insert(punchLogs).values({
    employeeId: emp.id, workDate: SPLIT,
    clockIn: null, clockOut: new Date(`${SPLIT}T17:30:00Z`),
    hoursWorked: null, status: MISSING_CLOCKIN_STATUS, source: "web",
  } as any);

  // HALF day: just a clock-in, nothing to pair with.
  await db.insert(punchLogs).values({
    employeeId: emp.id, workDate: HALF,
    clockIn: new Date(`${HALF}T09:00:00Z`), clockOut: new Date(`${HALF}T09:00:00Z`),
    hoursWorked: 0, status: MISSING_CLOCKOUT_STATUS, source: "web",
  } as any);

  // WHOLE day: a normal completed shift.
  await storage.createPunchLog({
    employeeId: emp.id, workDate: WHOLE,
    clockIn: new Date(`${WHOLE}T09:00:00Z`), clockOut: new Date(`${WHOLE}T17:00:00Z`),
    hoursWorked: 8, status: "completed", source: "manager", approved: true,
  });

  // STRAY day: a real complete shift PLUS a leftover zero-hour stray (the Nikia case).
  await storage.createPunchLog({
    employeeId: emp.id, workDate: STRAY,
    clockIn: new Date(`${STRAY}T10:12:00Z`), clockOut: new Date(`${STRAY}T16:10:00Z`),
    hoursWorked: 5.97, status: "completed", source: "web", approved: true,
  });
  await db.insert(punchLogs).values({
    employeeId: emp.id, workDate: STRAY,
    clockIn: new Date(`${STRAY}T10:12:00Z`), clockOut: new Date(`${STRAY}T10:12:00Z`),
    hoursWorked: 0, status: MISSING_CLOCKOUT_STATUS, source: "web",
  } as any);

  const result = await buildEmployeeTimesheet((await storage.getUser(emp.id))!, SPLIT, STRAY);
  const split = result.entries.find((e) => e.date === SPLIT)!;
  const half = result.entries.find((e) => e.date === HALF)!;
  const whole = result.entries.find((e) => e.date === WHOLE)!;
  const stray = result.entries.find((e) => e.date === STRAY)!;

  assert.equal(split.status, "missing_punch", "split day reads as a missing punch");
  assert.equal(split.canMerge, true, "split day offers merge");
  // The split day shows the clock-in (9:26) and the real clock-out (17:30).
  assert.ok(split.clockIn && split.clockOut, "split day shows both halves");

  assert.equal(half.status, "missing_punch", "lone clock-in is a missing punch");
  assert.ok(!half.canMerge, "a lone half-punch is NOT mergeable (needs the missing time)");

  assert.equal(whole.status, "complete", "complete day builds normally");
  assert.ok(!whole.canMerge, "a complete day is never mergeable");

  // Complete shift + leftover stray (Nikia): not mergeable, but offers remove-extra.
  assert.ok(!stray.canMerge, "a day with a complete shift is not mergeable");
  assert.equal(stray.canRemoveExtra, true, "complete shift + stray offers remove-extra");
});
