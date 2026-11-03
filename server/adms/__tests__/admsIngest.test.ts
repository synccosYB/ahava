/**
 * Integration tests for biometric-clock punch ingest (server/adms/ingest).
 * DB-backed — runs in CI against the migrated + seeded database, using the
 * seeded `admin-dev-001` user (same convention as the other integration suites).
 *
 * Run with: `tsx server/adms/__tests__/admsIngest.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  punchLogs,
  biometricDevices,
  biometricDeviceUsers,
  biometricDeviceEvents,
} from "@shared/schema";
import { ingestPunches } from "../ingest";
import { parseAttlog } from "../protocol";
import * as adms from "../store";

// This suite deletes/recreates test attendance records. Permit it only in
// GitHub CI's isolated ahava_ci database, never an ordinary Replit workspace
// or a database with production employee attendance.
const isolatedTestDatabase =
  process.env.CI === "true" &&
  (() => {
    try { return new URL(process.env.DATABASE_URL ?? "").pathname === "/ahava_ci"; }
    catch { return false; }
  })();
const integrationTest = isolatedTestDatabase ? test : test.skip;

const TEST_USER_ID = "admin-dev-001";
const DEVICE_SERIAL = "TEST-ADMS-SN-1";
const DEVICE_USER = "999"; // the user's number ON the clock

async function cleanup() {
  const dev = await adms.getDeviceBySerial(DEVICE_SERIAL);
  if (dev) {
    await db.delete(biometricDeviceEvents).where(eq(biometricDeviceEvents.deviceId, dev.id));
    await db.delete(biometricDeviceUsers).where(eq(biometricDeviceUsers.deviceId, dev.id));
    await db.delete(biometricDevices).where(eq(biometricDevices.id, dev.id));
  }
  // Remove any biometric punches this suite created (open or closed).
  await db
    .delete(punchLogs)
    .where(and(eq(punchLogs.employeeId, TEST_USER_ID), eq(punchLogs.source, "biometric")));
  // Also clear any stray OPEN punch on the shared seed user so clock-in is
  // deterministic (the suite runner is sequential, so this can't race another).
  await db
    .delete(punchLogs)
    .where(
      and(
        eq(punchLogs.employeeId, TEST_USER_ID),
        isNotNull(punchLogs.clockIn),
        isNull(punchLogs.clockOut),
      ),
    );
}

integrationTest("ADMS ingest: mapped user → clock-in, then clock-out, idempotent on resend", async (t) => {
  await cleanup();
  t.after(cleanup);

  const device = await adms.createDevice({ serialNumber: DEVICE_SERIAL, name: "Test Clock" } as any);
  await adms.mapDeviceUser(device.id, DEVICE_USER, TEST_USER_ID);

  // 1) First punch → clock-in.
  const r1 = await ingestPunches(device, parseAttlog(`${DEVICE_USER}\t2026-10-20 08:00:00\t0\t1`));
  assert.equal(r1.processed, 1, "first punch should be processed");
  const open = await storage.getLatestAttendanceForUser(TEST_USER_ID);
  assert.ok(open && open.clockIn && !open.clockOut, "employee should now be clocked in");
  assert.equal(open!.source, "biometric", "punch should be tagged as a biometric-device punch");
  assert.equal(open!.kioskDeviceId, null, "fingerprint clock is not a kiosk_devices FK");
  const linked = (await adms.listEvents(device.id, 10)).find((e) => e.punchLogId === open!.id);
  assert.ok(linked, "fingerprint event should link device to its punch");
  assert.equal(linked!.deviceId, device.id);

  // 2) Second punch → clock-out (derived from open state, not the device status key).
  const r2 = await ingestPunches(device, parseAttlog(`${DEVICE_USER}\t2026-10-20 17:00:00\t1\t1`));
  assert.equal(r2.processed, 1, "second punch should be processed");
  const closed = await storage.getLatestAttendanceForUser(TEST_USER_ID);
  assert.ok(closed && closed.clockOut, "employee should now be clocked out");

  // 3) Idempotency: re-sending the FIRST punch (same device time) is a no-op.
  const r3 = await ingestPunches(device, parseAttlog(`${DEVICE_USER}\t2026-10-20 08:00:00\t0\t1`));
  assert.equal(r3.processed, 0, "resent punch must not create a new record");
  assert.equal(r3.duplicates, 1, "resent punch must be counted as a duplicate");
});

integrationTest("ADMS ingest: unmapped user is parked as pending_mapping, never dropped", async (t) => {
  await cleanup();
  t.after(cleanup);

  const device = await adms.createDevice({ serialNumber: DEVICE_SERIAL, name: "Test Clock" } as any);
  // No mapping, and a device-user that won't auto-match any employeeNumber.
  const unknownUser = "zzz-no-such-emp-0001";

  const r = await ingestPunches(device, parseAttlog(`${unknownUser}\t2026-10-20 09:00:00\t0\t1`));
  assert.equal(r.pendingMapping, 1, "unmapped punch should be parked as pending_mapping");
  assert.equal(r.processed, 0, "unmapped punch should not create a punch_log");

  const events = await adms.listEvents(device.id, 10);
  const parked = events.find((e) => e.deviceUserId === unknownUser);
  assert.ok(parked, "the raw event must be persisted (nothing is dropped)");
  assert.equal(parked!.status, "pending_mapping");
});
