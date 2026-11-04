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
import { parseAttlog } from "../protocol";
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

test("a next-day punch caps the stale shift at 13h and opens a new shift (no 24h shift)", async (t) => {
  await setup();

  // Employee clocked in ~24h ago and never clocked out (forgot).
  const staleIn = new Date(Date.now() - 24 * 60 * 60 * 1000);
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

  // New punch comes in now (the "next day" clock-in).
  const r = await ingestPunches(device(), parseAttlog(`${DEVICE_USER}\t2026-10-20 08:00:00\t0\t1`));
  assert.equal(r.processed, 1, "the new punch is processed");

  // The stale shift is now CLOSED, capped near the 13h mark — NOT ~24h.
  const closed = await storage.getPunchLog(stale.id);
  assert.ok(closed?.clockOut, "stale shift was given a clock-out");
  const hrs = (new Date(closed!.clockOut as any).getTime() - staleIn.getTime()) / 3600000;
  assert.ok(hrs > 12 && hrs < 13.5, `stale shift capped near 13h, got ${hrs.toFixed(2)}h`);

  // A fresh OPEN shift exists for the new punch (started ~now, not 24h long).
  const latest = await storage.getLatestAttendanceForUser(employeeId);
  assert.ok(latest && latest.clockIn && !latest.clockOut, "a new open shift exists");
  assert.notEqual(latest!.id, stale.id, "the new shift is a different punch, not the stale one");
  const newAgeH = (Date.now() - new Date(latest!.clockIn as any).getTime()) / 3600000;
  assert.ok(newAgeH < 1, `the new shift started ~now, got ${newAgeH.toFixed(2)}h ago`);

  // The capped shift is flagged for manager review.
  const flags = await db.select().from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.employeeId, employeeId), eq(attendanceExceptions.type, "max_shift_split")));
  assert.ok(flags.length >= 1, "a max_shift_split exception was raised for the capped shift");
});

test("a normal same-day punch-out still closes the shift at the punch (no spurious cap)", async (t) => {
  t.after(cleanup);
  // Clean prior state; reuse the same employee/device (exceptions reference
  // punch_logs, so clear them first).
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});

  const recentIn = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8h ago (within limit)
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
  const hrs = (new Date(closed!.clockOut as any).getTime() - recentIn.getTime()) / 3600000;
  assert.ok(hrs > 7.5 && hrs < 8.5, `closed at ~8h (the real punch), got ${hrs.toFixed(2)}h`);

  // No new open shift was started (it was a clock-OUT, not a new clock-in).
  const latest = await storage.getLatestAttendanceForUser(employeeId);
  assert.ok(latest && latest.clockOut, "employee is clocked out, not re-opened");
});

function device() {
  return { id: deviceId, companyId: null } as any;
}
