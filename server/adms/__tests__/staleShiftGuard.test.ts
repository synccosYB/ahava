/**
 * Live-clock ingest must NOT turn a forgotten punch-out into a 24h shift.
 *
 * Bug: the ingest toggled clock-out on any open punch, so an employee who forgot
 * to clock out and clocked in again the next day had the prior shift closed at
 * the new punch time — one ~24h shift. Fix: when the open shift already exceeds
 * the max-shift limit, cap it at the limit (flagged, unverified) and treat the
 * incoming punch as a fresh clock-in.
 *
 * Run with: `npx tsx server/adms/__tests__/staleShiftGuard.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  users,
  punchLogs,
  attendanceExceptions,
  biometricDevices,
  biometricDeviceUsers,
  biometricDeviceEvents,
} from "@shared/schema";
import { ingestPunches } from "../ingest";
import { parseAttlog, parseDevicePunchTime } from "../protocol";
import { resolveEmployeeTimezone } from "../../services/punchOverlap";
import * as adms from "../store";

const stamp = `stale-${Date.now().toString(36)}`;
const DEVICE_USER = "7001";
let employeeId = "";
let deviceId = "";

async function setup() {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Stale", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  const dev = await adms.createDevice({ serialNumber: `SN-${stamp}`, name: `Dev ${stamp}` } as any);
  deviceId = dev.id;
  await adms.mapDeviceUser(deviceId, DEVICE_USER, employeeId);
}

async function cleanup() {
  await db.delete(biometricDeviceEvents).where(eq(biometricDeviceEvents.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDeviceUsers).where(eq(biometricDeviceUsers.deviceId, deviceId)).catch(() => {});
  await db.delete(biometricDevices).where(eq(biometricDevices.id, deviceId)).catch(() => {});
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("a next-day punch marks the stale shift a MISSING PUNCH (no hours) and opens a new shift (no 24h shift)", async (t) => {
  await setup();
  const tz = await resolveEmployeeTimezone(employeeId);

  // The next-day clock-in, as the device reports it (local wall-clock). Punches
  // now carry the DEVICE's own time, so the stale shift's span is measured
  // against this instant, not server "now".
  const newIn = parseDevicePunchTime("2026-10-21 08:00:00", tz)!;
  // Employee clocked in ~24h earlier (the day before) and never clocked out.
  const staleIn = new Date(newIn.getTime() - 24 * 60 * 60 * 1000);
  const stale = await storage.createPunchLog({
    employeeId,
    workDate: staleIn.toISOString().slice(0, 10),
    clockIn: staleIn,
    clockOut: null,
    hoursWorked: null,
    status: "in-progress",
    source: "biometric",
    approved: true,
  });

  // The next-day punch comes in.
  const r = await ingestPunches(device(), parseAttlog(`${DEVICE_USER}\t2026-10-21 08:00:00\t0\t1`));
  assert.equal(r.processed, 1, "the new punch is processed");

  // The stale shift is STOPPED and marked a missing punch: NO worked hours
  // recorded (not a "13h worked" shift), status = missing_clockout. The
  // clock-out is only a placeholder at the 13h mark so the row leaves the
  // one-open-punch slot — it must NOT be ~24h and must carry 0 hours.
  const closed = await storage.getPunchLog(stale.id);
  assert.equal(closed?.status, "missing_clockout", "stale shift marked missing_clockout");
  assert.equal(closed?.hoursWorked, 0, "no worked hours recorded for the missing punch");
  assert.ok(closed?.clockOut, "stale shift left the open slot (placeholder clock-out)");
  const hrs = (new Date(closed!.clockOut as any).getTime() - staleIn.getTime()) / 3600000;
  assert.ok(hrs > 12 && hrs < 13.5, `placeholder sits near the 13h mark, got ${hrs.toFixed(2)}h`);

  // A fresh OPEN shift exists for the new punch, started at the DEVICE time of
  // the new punch (not ~24h long, and not server-arrival time).
  const latest = await storage.getLatestAttendanceForUser(employeeId);
  assert.ok(latest && latest.clockIn && !latest.clockOut, "a new open shift exists");
  assert.notEqual(latest!.id, stale.id, "the new shift is a different punch, not the stale one");
  assert.equal(
    new Date(latest!.clockIn as any).getTime(),
    newIn.getTime(),
    "the new shift started at the device punch time",
  );

  // The missing punch is flagged for manager review.
  const flags = await db.select().from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.employeeId, employeeId), eq(attendanceExceptions.type, "missing_clockout")));
  assert.ok(flags.length >= 1, "a missing_clockout exception was raised for the stale shift");
});

test("a normal same-day punch-out still closes the shift at the punch (no spurious cap)", async (t) => {
  t.after(cleanup);
  // Clean prior state; reuse the same employee/device (exceptions reference
  // punch_logs, so clear them first).
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  const tz = await resolveEmployeeTimezone(employeeId);

  // The device clock-out time, and a clock-in 8h earlier (within the limit).
  const out = parseDevicePunchTime("2026-10-21 17:00:00", tz)!;
  const recentIn = new Date(out.getTime() - 8 * 60 * 60 * 1000);
  const open = await storage.createPunchLog({
    employeeId,
    workDate: recentIn.toISOString().slice(0, 10),
    clockIn: recentIn,
    clockOut: null,
    hoursWorked: null,
    status: "in-progress",
    source: "biometric",
    approved: true,
  });

  const r = await ingestPunches(device(), parseAttlog(`${DEVICE_USER}\t2026-10-21 17:00:00\t1\t1`));
  assert.equal(r.processed, 1);

  const closed = await storage.getPunchLog(open.id);
  assert.ok(closed?.clockOut, "the shift was closed normally");
  // Closed at the DEVICE's reported out-time (not server-arrival time).
  assert.equal(
    new Date(closed!.clockOut as any).getTime(),
    out.getTime(),
    "closed at the device punch-out time",
  );
  const hrs = (new Date(closed!.clockOut as any).getTime() - recentIn.getTime()) / 3600000;
  assert.ok(hrs > 7.5 && hrs < 8.5, `closed at ~8h (the real punch), got ${hrs.toFixed(2)}h`);

  // No new open shift was started (it was a clock-OUT, not a new clock-in).
  const latest = await storage.getLatestAttendanceForUser(employeeId);
  assert.ok(latest && latest.clockOut, "employee is clocked out, not re-opened");
});

function device() {
  return { id: deviceId, companyId: null } as any;
}
