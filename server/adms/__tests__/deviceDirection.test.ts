/**
 * Honor the clock's In/Out key (per-employee useDevicePunchDirection). When on,
 * a biometric punch is recorded as clock-in or clock-out per the device status
 * code, instead of auto-guessing from shift state — so one forgotten punch no
 * longer flips the direction of every punch after it. When off, the status code
 * is ignored (direction derived from state, as before).
 *
 * Run with: `npx tsx server/adms/__tests__/deviceDirection.test.ts` (needs DATABASE_URL).
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
import { parseAttlog } from "../protocol";
import * as adms from "../store";

const stamp = `devdir-${Date.now().toString(36)}`;
let deviceId = "";
const created: string[] = [];

async function makeEmp(suffix: string, useDevice: boolean): Promise<string> {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-${suffix}@example.invalid`, firstName: "Dev", lastName: `${stamp}${suffix}`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: "hourly", useDevicePunchDirection: useDevice,
  });
  created.push(emp.id);
  return emp.id;
}

function dev() { return { id: deviceId, companyId: null } as any; }
// pin \t time \t status \t verify  (status 0 = check-in, 1 = check-out)
const line = (pin: string, time: string, status: string) => parseAttlog(`${pin}\t${time}\t${status}\t1`);

before(async () => {
  deviceId = (await adms.createDevice({ serialNumber: `SN-${stamp}`, name: `Dev ${stamp}` } as any)).id;
});
after(async () => {
  await db.delete(biometricDeviceEvents).where(eq(biometricDeviceEvents.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDeviceUsers).where(eq(biometricDeviceUsers.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDevices).where(eq(biometricDevices.id, deviceId)).catch(() => {});
  for (const id of created) {
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, id)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id)).catch(() => {});
    await db.delete(users).where(eq(users.id, id)).catch(() => {});
  }
});

test("device OUT with no open shift → clock-out-only MISSING PUNCH (forgot to clock in)", async () => {
  const id = await makeEmp("a", true);
  await adms.mapDeviceUser(deviceId, "8001", id);

  const r = await ingestPunches(dev(), line("8001", "2026-11-10 17:00:00", "1")); // 1 = check-out
  assert.equal(r.processed, 1);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "missing_clockin", "recorded as a missing-clock-in punch");
  assert.equal(rows[0].clockIn, null, "no clock-in");
  assert.ok(rows[0].clockOut, "clock-out kept");
  const flags = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.employeeId, id));
  assert.ok(flags.some((f) => f.type === "missing_clockin"), "flagged for review");
});

test("device IN while a shift is open → old shift capped missing, new shift opens (no close)", async () => {
  const id = await makeEmp("b", true);
  await adms.mapDeviceUser(deviceId, "8002", id);

  // Open a shift (a check-in).
  await ingestPunches(dev(), line("8002", "2026-11-10 09:00:00", "0")); // 0 = check-in
  // Device says IN again while still open → forgot to clock out.
  const r = await ingestPunches(dev(), line("8002", "2026-11-10 14:00:00", "0"));
  assert.equal(r.processed, 1);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 2, "two shifts (old capped + new)");
  const capped = rows.find((p) => p.status === "missing_clockout");
  const open = rows.find((p) => p.clockIn && !p.clockOut);
  assert.ok(capped, "the earlier shift was capped as a missing punch");
  assert.ok(open, "a fresh open shift exists for the second IN");
});

test("device OUT while a shift is open → closes it normally", async () => {
  const id = await makeEmp("c", true);
  await adms.mapDeviceUser(deviceId, "8003", id);

  await ingestPunches(dev(), line("8003", "2026-11-10 09:00:00", "0")); // in
  const r = await ingestPunches(dev(), line("8003", "2026-11-10 17:00:00", "1")); // out
  assert.equal(r.processed, 1);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 1, "one closed shift");
  assert.ok(rows[0].clockIn && rows[0].clockOut, "closed");
  assert.ok(Number(rows[0].hoursWorked) > 7, "~8h recorded");
});

test("WITHOUT the flag, the device status code is ignored (state logic): an OUT-coded tap with no open shift opens a shift", async () => {
  const id = await makeEmp("d", false); // flag OFF
  await adms.mapDeviceUser(deviceId, "8004", id);

  // Status 1 (check-out) but no open shift. State logic ignores the code and
  // treats it as a clock-IN (opens a shift).
  const r = await ingestPunches(dev(), line("8004", "2026-11-10 17:00:00", "1"));
  assert.equal(r.processed, 1);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].clockIn && !rows[0].clockOut, "opened a shift (status code ignored)");
  assert.notEqual(rows[0].status, "missing_clockin");
});
