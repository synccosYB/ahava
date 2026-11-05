/**
 * Cleanup for forgotten punch-outs. Per the attendance rule a forgotten
 * clock-out is NOT a worked shift: an over-13h closed shift (the 24h-shift
 * leftover) is turned into a MISSING PUNCH (0 hours, placeholder clock-out at
 * the 13h mark), and a shift an OLDER version of the tool wrongly capped-and-
 * counted at 13h (marked by a max_shift_split exception) is converted too. The
 * pass is idempotent (a shift that's already a missing punch is skipped).
 *
 * Run with: `npx tsx server/__tests__/overlongShiftReconcile.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceExceptions, userEmploymentProfiles } from "@shared/schema";
import { reconcileOverlongShifts } from "../services/overlongShiftReconcile";
import { resolveEmployeeTimezone, localWorkDate } from "../services/punchOverlap";
import { parseDevicePunchTime } from "../adms/protocol";

const stamp = `overlong-${Date.now().toString(36)}`;
let employeeId = "";
let punchId = "";

async function cleanup() {
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("an existing ~24h shift becomes a MISSING PUNCH (0 hours), flagged, and the pass is idempotent", async (t) => {
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
  assert.equal(mine[0].cappedHours, 0, "preview shows it will become a 0-hour missing punch");
  const stillOpen = await storage.getPunchLog(punchId);
  assert.equal(new Date(stillOpen!.clockOut as any).getTime(), cout.getTime(), "preview did not modify the punch");
  assert.equal(stillOpen!.status, "completed", "preview did not change the status");

  // Apply — converts to a missing punch (no hours counted).
  const applied = await reconcileOverlongShifts({ apply: true });
  assert.ok(applied.fixed >= 1, "at least one shift fixed");
  const fixed = await storage.getPunchLog(punchId);
  assert.equal(fixed!.status, "missing_clockout", "shift marked a missing punch");
  assert.equal(Number(fixed!.hoursWorked), 0, "no hours counted for a forgotten punch-out");
  const hrs = (new Date(fixed!.clockOut as any).getTime() - cin.getTime()) / 3600000;
  assert.ok(hrs > 12 && hrs < 13.5, `placeholder clock-out sits near the 13h mark, got ${hrs.toFixed(2)}h`);

  const flags = await db.select().from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.employeeId, employeeId), eq(attendanceExceptions.type, "missing_clockout")));
  assert.ok(flags.length >= 1, "a missing_clockout review flag was raised");

  // Idempotent — re-running finds nothing for this employee (now a missing punch).
  const again = await reconcileOverlongShifts({ apply: true });
  assert.equal(again.items.filter((i) => i.employeeId === employeeId).length, 0, "a missing punch is not picked up again");
});

test("a shift an OLDER tool wrongly capped-and-counted at 13h is converted to a missing punch (0 hours)", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-b@example.invalid`, firstName: "Capped", lastName: `${stamp}b`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  const empB = emp.id;
  t.after(async () => {
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, empB)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, empB)).catch(() => {});
    await db.delete(users).where(eq(users.id, empB)).catch(() => {});
  });

  // The leftover state from the OLD tool: a shift capped at EXACTLY 13h, counting
  // 13 worked hours, with a lingering max_shift_split exception (Bassy's case).
  const cin = new Date("2026-11-03T09:32:00-05:00");
  const cout = new Date(cin.getTime() + 13 * 3600 * 1000);
  const p = await storage.createPunchLog({
    employeeId: empB, workDate: "2026-11-03", clockIn: cin, clockOut: cout,
    roundedClockIn: cin, roundedClockOut: cout,
    hoursWorked: 13, status: "complete", source: "biometric", approved: true,
  });
  const ex = await storage.createAttendanceException({
    employeeId: empB, exceptionDate: "2026-11-03", exceptionTime: cout,
    type: "max_shift_split", reason: "capped at 13h by the old tool", status: "pending",
  });
  if (ex?.id) await storage.updateAttendanceException(ex.id, { punchLogId: p.id });

  // The span scan alone would miss it (it's exactly 13h); the max_shift_split
  // exception is what brings it in.
  const applied = await reconcileOverlongShifts({ apply: true });
  assert.ok(applied.items.some((i) => i.employeeId === empB), "the capped-and-counted shift is picked up");

  const after = await storage.getPunchLog(p.id);
  assert.equal(after!.status, "missing_clockout", "converted to a missing punch");
  assert.equal(Number(after!.hoursWorked), 0, "the wrongly-counted 13 hours are removed");

  // The lingering max_shift_split exception was repurposed (not duplicated).
  const exs = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.employeeId, empB));
  assert.equal(exs.length, 1, "exactly one exception (reused, not duplicated)");
  assert.equal(exs[0].type, "missing_clockout", "the exception now reads missing_clockout");
});

test("a sub-13h shift that crosses midnight is a missing punch for a non-overnight employee, but left alone for an overnight worker", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const mk = async (suffix: string, overnight: boolean) => {
    const [e] = await db.insert(users).values({
      email: `${stamp}-${suffix}@example.invalid`, firstName: "Cross", lastName: `${stamp}${suffix}`,
      role: "employee", companyId: admin?.companyId ?? null,
    }).returning();
    await db.insert(userEmploymentProfiles).values({ userId: e.id, payType: "hourly", overnightShiftsAllowed: overnight });
    return e.id;
  };
  const dayId = await mk("x", false);
  const nightId = await mk("y", true);
  t.after(async () => {
    for (const id of [dayId, nightId]) {
      await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, id)).catch(() => {});
      await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
      await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id)).catch(() => {});
      await db.delete(users).where(eq(users.id, id)).catch(() => {});
    }
  });

  // A ~12h shift that crosses local midnight (8:34pm → 8:41am next day), the
  // Garcia artifact, recorded as a counted shift for BOTH employees.
  for (const id of [dayId, nightId]) {
    const tz = await resolveEmployeeTimezone(id);
    const cin = parseDevicePunchTime("2026-11-04 20:34:00", tz)!;
    const cout = parseDevicePunchTime("2026-11-05 08:41:00", tz)!;
    await storage.createPunchLog({
      employeeId: id, workDate: localWorkDate(cin, tz),
      clockIn: cin, clockOut: cout, roundedClockIn: cin, roundedClockOut: cout,
      hoursWorked: 12.12, status: "complete", source: "biometric", approved: true,
    });
  }

  const applied = await reconcileOverlongShifts({ apply: true });
  assert.ok(applied.items.some((i) => i.employeeId === dayId), "the non-overnight cross-midnight shift is picked up");
  assert.ok(!applied.items.some((i) => i.employeeId === nightId), "the overnight worker's shift is left alone");

  const [day] = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, dayId));
  assert.equal(day.status, "missing_clockout", "non-overnight: converted to a missing punch");
  assert.equal(Number(day.hoursWorked), 0, "non-overnight: no hours counted");

  const [night] = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, nightId));
  assert.equal(Number(night.hoursWorked), 12.12, "overnight worker: hours untouched");
  assert.notEqual(night.status, "missing_clockout", "overnight worker: still a normal shift");
});
