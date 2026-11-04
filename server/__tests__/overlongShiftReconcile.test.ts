/**
 * Cleanup for already-recorded over-long shifts (the 24h-shift bug's leftovers):
 * a closed shift longer than the max (13h) is capped at the limit, flagged, and
 * the pass is idempotent (a capped shift is no longer picked up).
 *
 * Run with: `npx tsx server/__tests__/overlongShiftReconcile.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceExceptions } from "@shared/schema";
import { reconcileOverlongShifts } from "../services/overlongShiftReconcile";

const stamp = `overlong-${Date.now().toString(36)}`;
let employeeId = "";
let punchId = "";

async function cleanup() {
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("an existing ~24h shift is capped at 13h, flagged, and the pass is idempotent", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Overlong", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // A 24h shift: clock-in 11/3 08:02, clock-out (the next-day clock-in) 11/4 08:09.
  const cin = new Date("2026-11-03T08:02:00-05:00");
  const cout = new Date("2026-11-04T08:09:00-05:00");
  const p = await storage.createPunchLog({
    employeeId, workDate: "2026-11-03", clockIn: cin, clockOut: cout,
    hoursWorked: 24.1, status: "completed", source: "biometric", approved: true,
  });
  punchId = p.id;

  // Dry run — reports it, writes nothing.
  const preview = await reconcileOverlongShifts({ apply: false });
  const mine = preview.items.filter((i) => i.employeeId === employeeId);
  assert.equal(mine.length, 1, "the 24h shift is found in preview");
  assert.ok(mine[0].originalHours > 23, "preview shows the original ~24h span");
  const stillOpen = await storage.getPunchLog(punchId);
  assert.equal(new Date(stillOpen!.clockOut as any).getTime(), cout.getTime(), "preview did not modify the punch");

  // Apply — caps at 13h and flags.
  const applied = await reconcileOverlongShifts({ apply: true });
  assert.ok(applied.fixed >= 1, "at least one shift fixed");
  const capped = await storage.getPunchLog(punchId);
  const hrs = (new Date(capped!.clockOut as any).getTime() - cin.getTime()) / 3600000;
  assert.ok(hrs > 12 && hrs < 13.5, `capped near 13h, got ${hrs.toFixed(2)}h`);
  assert.ok(Number(capped!.hoursWorked) <= 13.01, "hours recomputed to <= 13");

  const flags = await db.select().from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.employeeId, employeeId), eq(attendanceExceptions.type, "max_shift_split")));
  assert.ok(flags.length >= 1, "a review flag was raised");
  assert.ok(String(flags[0].reason).includes("2026-11-04"), "flag records the original mis-recorded clock-out for the manager");

  // Idempotent — re-running finds nothing for this employee (it's now 13h).
  const again = await reconcileOverlongShifts({ apply: true });
  assert.equal(again.items.filter((i) => i.employeeId === employeeId).length, 0, "capped shift is not picked up again");
});
