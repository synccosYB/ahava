/**
 * Fingerprint clock edit + delete (store layer): updateDevice changes mutable
 * fields; deleteDevice removes the clock AND its children (events, user maps,
 * queued commands, harvested templates), which have no ON DELETE cascade.
 *
 * Run with: `npx tsx server/__tests__/deviceEditDelete.test.ts` (needs DATABASE_URL).
 */
import crypto from "node:crypto";
// A valid 32-byte key so storeFingerprintTemplate can encrypt (CI's hex key doesn't decode to 32).
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import * as adms from "../adms/store";

const stamp = `dev-${Date.now().toString(36)}`;

test("updateDevice edits name, serial, and active flag", async () => {
  const d = await adms.createDevice({ serialNumber: `SN-${stamp}-a`, name: `Orig ${stamp}` });
  const updated = await adms.updateDevice(d.id, {
    name: `Renamed ${stamp}`,
    serialNumber: `SN-${stamp}-b`,
    isActive: false,
  });
  assert.equal(updated?.name, `Renamed ${stamp}`);
  assert.equal(updated?.serialNumber, `SN-${stamp}-b`);
  assert.equal(updated?.isActive, false);
  // Persisted.
  const fresh = await adms.getDevice(d.id);
  assert.equal(fresh?.serialNumber, `SN-${stamp}-b`);
  await adms.deleteDevice(d.id);
});

test("updateDevice on an unknown id returns undefined", async () => {
  const res = await adms.updateDevice("00000000-0000-0000-0000-000000000000", { name: "x" });
  assert.equal(res, undefined);
});

test("deleteDevice removes the clock and all its children", async () => {
  const d = await adms.createDevice({ serialNumber: `SN-${stamp}-del`, name: `Del ${stamp}` });
  // Seed one row in each child table.
  await adms.insertEventIfNew({ deviceId: d.id, deviceUserId: "7", devicePunchTime: "2026-01-01 08:00:00" });
  await adms.mapDeviceUser(d.id, "7", (await db.insert(schema.users).values({
    id: `${stamp}-u`, email: `${stamp}-u@test.local`, firstName: "Del", lastName: "User", role: "employee",
  }).returning())[0].id);
  await adms.enqueueCommand(d.id, "DATA QUERY FINGERTMP");
  await adms.storeFingerprintTemplate({
    sourceDeviceId: d.id, devicePin: "7", fingerIndex: 1,
    template: "QUJD", size: 100, valid: true, format: "FP", userId: null, companyId: null,
  });

  // Sanity: children exist.
  assert.equal((await db.select().from(schema.biometricDeviceEvents).where(eq(schema.biometricDeviceEvents.deviceId, d.id))).length, 1);
  assert.equal((await adms.getFingerprintStats(d.id)).total, 1);

  await adms.deleteDevice(d.id);

  assert.equal(await adms.getDevice(d.id), undefined, "device gone");
  assert.equal((await db.select().from(schema.biometricDeviceEvents).where(eq(schema.biometricDeviceEvents.deviceId, d.id))).length, 0, "events gone");
  assert.equal((await db.select().from(schema.biometricDeviceUsers).where(eq(schema.biometricDeviceUsers.deviceId, d.id))).length, 0, "user maps gone");
  assert.equal((await db.select().from(schema.biometricDeviceCommands).where(eq(schema.biometricDeviceCommands.deviceId, d.id))).length, 0, "commands gone");
  assert.equal((await adms.getFingerprintStats(d.id)).total, 0, "templates gone");

  await db.delete(schema.users).where(eq(schema.users.id, `${stamp}-u`));
});
