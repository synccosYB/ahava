/**
 * Cross-midnight shifts and the per-employee "works overnight" flag.
 *
 * Garcia's case: an evening punch gets mistaken for a new clock-in, then the
 * next morning's clock-in "closes" it into a bogus overnight shift. For a NON-
 * overnight employee, the ingest now splits that: the evening shift is capped as
 * a MISSING PUNCH and the morning punch starts a fresh shift. A genuine OVERNIGHT
 * worker (overnightShiftsAllowed) is exempt — their cross-midnight shift closes
 * normally.
 *
 * Run with: `npx tsx server/adms/__tests__/overnightShiftSplit.test.ts` (needs DATABASE_URL).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  users, punchLogs, attendanceExceptions, userEmploymentProfiles,
  biometricDevices, biometricDeviceUsers, biometricDeviceEvents,
} from "@shared/schema";
import { ingestPunches } from "../ingest";
import { parseAttlog, parseDevicePunchTime } from "../protocol";
import { resolveEmployeeTimezone, localWorkDate } from "../../services/punchOverlap";
import * as adms from "../store";

const stamp = `onsplit-${Date.now().toString(36)}`;
let deviceId = "";
const created: string[] = [];

async function makeEmp(suffix: string, overnight: boolean): Promise<string> {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-${suffix}@example.invalid`, firstName: "Night", lastName: `${stamp}${suffix}`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: "hourly", overnightShiftsAllowed: overnight,
  });
  created.push(emp.id);
  return emp.id;
}

async function cleanup() {
  await db.delete(biometricDeviceEvents).where(eq(biometricDeviceEvents.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDeviceUsers).where(eq(biometricDeviceUsers.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDevices).where(eq(biometricDevices.id, deviceId)).catch(() => {});
  for (const id of created) {
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, id)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id)).catch(() => {});
    await db.delete(users).where(eq(users.id, id)).catch(() => {});
  }
}

// Seed an OPEN evening shift (an evening punch mistaken for a clock-in).
async function seedOpenEvening(employeeId: string) {
  const tz = await resolveEmployeeTimezone(employeeId);
  const eveningIn = parseDevicePunchTime("2026-11-04 20:34:00", tz)!;
  await storage.createPunchLog({
    employeeId, workDate: localWorkDate(eveningIn, tz),
    clockIn: eveningIn, clockOut: null, roundedClockIn: eveningIn,
    hoursWorked: null, status: "in-progress", source: "biometric", approved: true,
  });
  return eveningIn;
}

before(async () => {
  deviceId = (await adms.createDevice({ serialNumber: `SN-${stamp}`, name: `Dev ${stamp}` } as any)).id;
});
after(cleanup);

test("NON-overnight employee: next-morning punch splits the stale evening shift into a missing punch + a fresh shift", async () => {
  const id = await makeEmp("day", false);
  await adms.mapDeviceUser(deviceId, "5001", id);
  const eveningIn = await seedOpenEvening(id);

  // The next morning's clock-in arrives (under 13h later, but a new day).
  const r = await ingestPunches({ id: deviceId, companyId: null } as any,
    parseAttlog(`5001\t2026-11-05 08:41:00\t0\t1`));
  assert.equal(r.processed, 1, "morning punch processed");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 2, "evening shift + a new morning shift");

  const evening = rows.find((p) => new Date(p.clockIn as any).getTime() === eveningIn.getTime())!;
  assert.equal(evening.status, "missing_clockout", "stale evening shift marked a missing punch");
  assert.equal(Number(evening.hoursWorked), 0, "no hours on the evening missing punch");
  const tz = await resolveEmployeeTimezone(id);
  const morningIn = parseDevicePunchTime("2026-11-05 08:41:00", tz)!;
  assert.ok(
    new Date(evening.clockOut as any).getTime() < morningIn.getTime(),
    "evening placeholder clock-out lands before the morning punch (no overlap, no overnight shift)",
  );

  const morning = rows.find((p) => p.id !== evening.id)!;
  assert.equal(new Date(morning.clockIn as any).getTime(), morningIn.getTime(), "morning shift starts at the morning punch");
  assert.equal(morning.clockOut, null, "morning shift is a fresh open shift");

  const flags = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.employeeId, id));
  assert.ok(flags.some((f) => f.type === "missing_clockout"), "evening shift flagged for review");
});

test("OVERNIGHT-allowed employee: the cross-midnight shift closes normally (no split)", async () => {
  const id = await makeEmp("night", true);
  await adms.mapDeviceUser(deviceId, "5002", id);
  const eveningIn = await seedOpenEvening(id);

  const r = await ingestPunches({ id: deviceId, companyId: null } as any,
    parseAttlog(`5002\t2026-11-05 08:41:00\t0\t1`));
  assert.equal(r.processed, 1, "morning punch processed");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 1, "one shift — the overnight shift was closed, not split");
  const shift = rows[0];
  assert.equal(new Date(shift.clockIn as any).getTime(), eveningIn.getTime(), "same evening clock-in");
  assert.ok(shift.clockOut, "shift was closed by the morning punch");
  assert.notEqual(shift.status, "missing_clockout", "not a missing punch");
  assert.ok(Number(shift.hoursWorked) > 12, `~12h overnight shift counted, got ${shift.hoursWorked}`);
});
