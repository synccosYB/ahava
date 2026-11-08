/**
 * Enrollment station (ZK9500 desk reader) storage. A station-enrolled finger is
 * stored under ENROLL_STATION_SOURCE, encrypted at rest, listed alongside
 * clock-harvested fingers, and removed only by the station-scoped delete (which
 * leaves clock-harvested templates alone). Distribution keys on userId, so a
 * station finger is pushable exactly like a harvested one.
 *
 * Run with: `npx tsx server/adms/__tests__/enrollStation.test.ts` (needs DATABASE_URL).
 */
import crypto from "node:crypto";
// A valid 32-byte key before any template is encrypted (CI's hex key doesn't
// base64-decode to 32 bytes); this suite never decrypts across processes.
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import {
  storeFingerprintTemplate,
  listFingerprintsForUser,
  deleteStationFinger,
  getDistributableTemplates,
  ENROLL_STATION_SOURCE,
} from "../store";

const stamp = `enroll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

test("station enroll: encrypted at rest, listed, station-scoped delete, still distributable", async (t) => {
  const admin = await db.select().from(schema.users).where(eq(schema.users.id, "admin-dev-001")).limit(1);
  const companyId = admin[0]?.companyId ?? null;
  const [device] = await db
    .insert(schema.biometricDevices)
    .values({ serialNumber: `SN-${stamp}`, name: `Clock ${stamp}`, companyId })
    .returning();
  const [emp] = await db
    .insert(schema.users)
    .values({ email: `${stamp}@example.invalid`, firstName: "Fin", lastName: stamp, role: "employee", companyId })
    .returning();
  await db.insert(schema.userEmploymentProfiles).values({ userId: emp.id, employeeNumber: `E${stamp.slice(-4)}` });

  t.after(async () => {
    await db.delete(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.userId, emp.id)).catch(() => {});
    await db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, emp.id)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, emp.id)).catch(() => {});
    await db.delete(schema.biometricDevices).where(eq(schema.biometricDevices.id, device.id)).catch(() => {});
  });

  const CLEAR = "VGhpcyBpcyBhIGZha2UgdGVtcGxhdGUgYmxvYg=="; // base64 "fake template blob"

  // A station-enrolled finger (index 1) and a clock-harvested finger (index 2).
  await storeFingerprintTemplate({
    sourceDeviceId: ENROLL_STATION_SOURCE, devicePin: `E${stamp.slice(-4)}`, fingerIndex: 1,
    template: CLEAR, size: 512, valid: true, format: "ZKFinger10", userId: emp.id, companyId,
  });
  await storeFingerprintTemplate({
    sourceDeviceId: device.id, devicePin: "7", fingerIndex: 2,
    template: CLEAR, size: 512, valid: true, format: "FP", userId: emp.id, companyId,
  });

  // Encrypted at rest — the stored blob is never the cleartext template.
  const rows = await db
    .select()
    .from(schema.fingerprintTemplates)
    .where(eq(schema.fingerprintTemplates.userId, emp.id));
  assert.equal(rows.length, 2, "two templates stored");
  for (const r of rows) assert.notEqual(r.templateData, CLEAR, "template is encrypted at rest");

  // Listed, with correct sources.
  const listed = await listFingerprintsForUser(emp.id);
  const byFinger = new Map(listed.map((f) => [f.fingerIndex, f]));
  assert.equal(byFinger.get(1)?.source, ENROLL_STATION_SOURCE, "finger 1 is the station source");
  assert.notEqual(byFinger.get(2)?.source, ENROLL_STATION_SOURCE, "finger 2 is a clock source");

  // Distributable (decrypts back to cleartext) — pushable to clocks like any.
  const dist = await getDistributableTemplates(companyId, emp.id);
  assert.ok(dist.length >= 2, "both templates are distributable");
  for (const d of dist) assert.equal(d.template, CLEAR, "decrypts back to the original blob");

  // Station-scoped delete removes the station finger only.
  assert.equal(await deleteStationFinger(emp.id, 1), true, "station finger removed");
  assert.equal(await deleteStationFinger(emp.id, 2), false, "clock finger is NOT station-removable");
  const after = await listFingerprintsForUser(emp.id);
  assert.deepEqual(after.map((f) => f.fingerIndex).sort(), [2], "only the clock finger remains");
});
