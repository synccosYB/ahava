/**
 * The background max-shift check (`runAutoClockOut`, run by the in-process job
 * scheduler) must STOP a forgotten punch-out and mark it a MISSING PUNCH — no
 * worked hours, no auto "13h" shift, and no placeholder second shift. An open
 * shift still within the limit is left alone.
 *
 * Run with: `npx tsx server/services/__tests__/autoClockOutMissing.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { users, punchLogs, attendanceExceptions } from "@shared/schema";
import { runAutoClockOut } from "../policyEnforcement";

const stamp = `autoco-${Date.now().toString(36)}`;
let employeeId = "";

async function cleanup() {
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("a shift open past the max shift is marked a missing punch (no hours, no second shift)", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "AutoCO", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // Clocked in ~20h ago, never clocked out (forgot). Feigy's case.
  const staleIn = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const stale = await storage.createPunchLog({
    employeeId, workDate: staleIn.toISOString().slice(0, 10),
    clockIn: staleIn, clockOut: null, hoursWorked: null,
    status: "in-progress", source: "biometric", approved: true,
  });

  const alerts = await runAutoClockOut();

  const marked = await storage.getPunchLog(stale.id);
  assert.equal(marked?.status, "missing_clockout", "stale shift marked missing_clockout");
  assert.equal(marked?.hoursWorked, 0, "no worked hours recorded");
  assert.ok(marked?.clockOut, "left the open slot via a placeholder clock-out");

  // No placeholder SECOND shift was created (we do not auto-clock-in a new shift).
  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, employeeId));
  assert.equal(rows.length, 1, "exactly one punch — no auto-started second shift");

  // Manager flagged.
  const flags = await db.select().from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.employeeId, employeeId), eq(attendanceExceptions.type, "missing_clockout")));
  assert.ok(flags.length >= 1, "a missing_clockout exception was raised");
  assert.ok(alerts.some((a) => a.employeeId === employeeId && a.type === "missing_clockout"), "an alert was returned");

  // Idempotent: the marked shift is no longer open, so a second pass is a no-op.
  await runAutoClockOut();
  const after = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, employeeId));
  assert.equal(after.length, 1, "still one punch after a second pass");
});

test("a shift still within the max shift is left untouched (stays open)", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-ok@example.invalid`, firstName: "AutoCOok", lastName: `${stamp}ok`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  const okId = emp.id;
  t.after(async () => {
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, okId)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, okId)).catch(() => {});
    await db.delete(users).where(eq(users.id, okId)).catch(() => {});
  });

  const recentIn = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6h, still working
  const open = await storage.createPunchLog({
    employeeId: okId, workDate: recentIn.toISOString().slice(0, 10),
    clockIn: recentIn, clockOut: null, hoursWorked: null,
    status: "in-progress", source: "biometric", approved: true,
  });

  await runAutoClockOut();

  const still = await storage.getPunchLog(open.id);
  assert.equal(still?.status, "in-progress", "within-limit shift stays in-progress");
  assert.equal(still?.clockOut, null, "within-limit shift stays open");
});
