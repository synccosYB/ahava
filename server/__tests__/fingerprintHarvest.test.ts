/**
 * Fingerprint Harvest storage (Phase 2): command queue + encrypted template
 * store. Verifies the queue hands out pending commands once (then marks them
 * sent), ack records the result, and templates upsert idempotently per
 * (device, PIN, finger) and are encrypted at rest.
 *
 * Run with: `npx tsx server/__tests__/fingerprintHarvest.test.ts` (needs DATABASE_URL).
 */
import crypto from "node:crypto";
// Ensure a valid 32-byte key before any template is encrypted. CI sets a
// hex-format key that doesn't base64-decode to 32 bytes; override it like
// biometric.test.ts does (this suite never decrypts across processes).
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import * as adms from "../adms/store";

const stamp = `fh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const [device] = await db
  .insert(schema.biometricDevices)
  .values({ serialNumber: `SN-${stamp}`, name: `Test ${stamp}` })
  .returning();

test("command queue: enqueue → take (marks sent, once) → ack", async () => {
  await adms.enqueueCommand(device.id, "DATA QUERY FINGERTMP");
  const first = await adms.takePendingCommands(device.id);
  assert.equal(first.length, 1);
  assert.equal(first[0].command, "DATA QUERY FINGERTMP");
  // Taken commands are marked sent, so a second poll returns nothing.
  const second = await adms.takePendingCommands(device.id);
  assert.equal(second.length, 0, "a sent command isn't handed out again");
  await adms.ackCommand(first[0].seq, "ID=" + first[0].seq + "&Return=0");
  const [row] = await db
    .select()
    .from(schema.biometricDeviceCommands)
    .where(eq(schema.biometricDeviceCommands.id, first[0].id));
  assert.equal(row.status, "acked");
  assert.match(row.result || "", /Return=0/);
});

test("template store: encrypted at rest + idempotent upsert per finger", async () => {
  await adms.storeFingerprintTemplate({
    sourceDeviceId: device.id, devicePin: "7", fingerIndex: 1,
    template: "QUJDtemplate", size: 1998, valid: true, format: "FP",
    userId: null, companyId: null,
  });
  // Re-harvest the SAME finger → update, not duplicate.
  await adms.storeFingerprintTemplate({
    sourceDeviceId: device.id, devicePin: "7", fingerIndex: 1,
    template: "QUJDtemplate-v2", size: 2000, valid: true, format: "FP",
    userId: null, companyId: null,
  });
  // A different finger → separate row.
  await adms.storeFingerprintTemplate({
    sourceDeviceId: device.id, devicePin: "7", fingerIndex: 2,
    template: "secondfinger", size: 1998, valid: true, format: "FP",
    userId: null, companyId: null,
  });

  assert.equal((await adms.getFingerprintStats(device.id)).total, 2, "one row per finger, upsert not duplicate");

  const rows = await db
    .select()
    .from(schema.fingerprintTemplates)
    .where(eq(schema.fingerprintTemplates.sourceDeviceId, device.id));
  const f1 = rows.find((r) => r.fingerIndex === 1)!;
  assert.notEqual(f1.templateData, "QUJDtemplate-v2", "template is NOT stored in cleartext");
  assert.ok(f1.templateData.length > 20, "stored as an encrypted blob");
  assert.equal(f1.size, 2000, "upsert refreshed the metadata");
});

test("distribute: mapped template → PIN=employee number, decrypted template", async () => {
  // An employee with an Employee Number, and one of their fingers harvested.
  const [emp] = await db
    .insert(schema.users)
    .values({ id: `${stamp}-emp`, email: `${stamp}-emp@test.local`, firstName: "Dana", lastName: "Finger", role: "employee" })
    .returning();
  await db.insert(schema.userEmploymentProfiles).values({ userId: emp.id, employeeNumber: "4242" });
  await adms.storeFingerprintTemplate({
    sourceDeviceId: device.id, devicePin: "9001", fingerIndex: 0,
    template: "ZGFuYXMtZmluZ2Vy", size: 1998, valid: true, format: "FP",
    userId: emp.id, companyId: null,
  });

  const list = await adms.getDistributableTemplates(null);
  const mine = list.find((t) => t.userId === emp.id);
  assert.ok(mine, "the mapped template is distributable");
  assert.equal(mine!.pin, "4242", "target PIN is the Employee Number (so it auto-attributes everywhere)");
  assert.equal(mine!.template, "ZGFuYXMtZmluZ2Vy", "template decrypts back to the original blob");
  assert.equal(mine!.name, "Dana Finger");

  await db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, emp.id));
  await db.delete(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.userId, emp.id));
  await db.delete(schema.users).where(eq(schema.users.id, emp.id));
});

test.after(async () => {
  await db.delete(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.sourceDeviceId, device.id));
  await db.delete(schema.biometricDeviceCommands).where(eq(schema.biometricDeviceCommands.deviceId, device.id));
  await db.delete(schema.biometricDevices).where(inArray(schema.biometricDevices.id, [device.id]));
});
