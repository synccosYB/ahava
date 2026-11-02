/**
 * Bulk fingerprint sync helpers (Push/Pull all, or by location). Verifies the
 * shared logic the per-clock buttons AND the new all/by-location buttons use:
 *  - queueHarvest enqueues the query commands for a device,
 *  - queueDistribute pushes a linked employee's template (keyed to Employee #),
 *  - devicesForBulk returns all clocks, or just one location's.
 *
 * Run with: `npx tsx server/__tests__/bulkSync.test.ts` (needs DATABASE_URL).
 */
import crypto from "node:crypto";
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import * as adms from "../adms/store";
import { queueHarvest, queueDistribute, devicesForBulk } from "../adms/routes";

const stamp = `bulk-${Date.now().toString(36)}`;

// Two clocks at two different locations, plus one linked, harvested template.
const [co] = await db.insert(schema.companies).values({ name: `Co ${stamp}` }).returning();
const [locA] = await db.insert(schema.locations).values({ name: `LocA ${stamp}`, companyId: co.id }).returning();
const [locB] = await db.insert(schema.locations).values({ name: `LocB ${stamp}`, companyId: co.id }).returning();
const devA = await adms.createDevice({ serialNumber: `SN-${stamp}-A`, name: `A ${stamp}`, locationId: locA.id });
const devB = await adms.createDevice({ serialNumber: `SN-${stamp}-B`, name: `B ${stamp}`, locationId: locB.id });

test("queueHarvest enqueues the query commands for a device", async () => {
  const n = await queueHarvest(devA.id);
  assert.equal(n, 3);
  const pending = await adms.takePendingCommands(devA.id);
  assert.ok(pending.length >= 3, "commands are queued and handed to the clock");
});

test("devicesForBulk: all vs one location", async () => {
  const all = await devicesForBulk(null);
  const ids = new Set(all.map((d) => d.id));
  assert.ok(ids.has(devA.id) && ids.has(devB.id), "null => every clock");
  const justB = await devicesForBulk(locB.id);
  assert.ok(justB.every((d) => d.locationId === locB.id), "a locationId => only that location");
  assert.ok(justB.some((d) => d.id === devB.id));
  assert.ok(!justB.some((d) => d.id === devA.id), "other locations excluded");
});

test("queueDistribute pushes a linked template keyed to the Employee Number", async () => {
  const [emp] = await db
    .insert(schema.users)
    .values({ id: `${stamp}-e`, email: `${stamp}-e@test.local`, firstName: "Bulk", lastName: "Tester", role: "employee" })
    .returning();
  await db.insert(schema.userEmploymentProfiles).values({ userId: emp.id, employeeNumber: "8800" });
  await adms.storeFingerprintTemplate({
    sourceDeviceId: devA.id, devicePin: "3", fingerIndex: 0,
    template: "YmxvYg==", size: 100, valid: true, format: "FP", userId: emp.id, companyId: null,
  });

  const r = await queueDistribute(devB); // push onto clock B
  assert.ok(r.people >= 1, "at least the linked person is pushed");
  assert.ok(r.queued >= 2, "a user command + a template command were queued");
  // The push mapped the Employee Number as the device PIN on the target clock.
  const mapped = await adms.getMappedUserId(devB.id, "8800");
  assert.equal(mapped, emp.id, "punches for PIN 8800 on clock B will attribute to the employee");

  await db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, emp.id));
  await db.delete(schema.users).where(eq(schema.users.id, emp.id));
});

test.after(async () => {
  for (const d of [devA, devB]) {
    await adms.deleteDevice(d.id).catch(() => {});
  }
  await db.delete(schema.locations).where(inArray(schema.locations.id, [locA.id, locB.id])).catch(() => {});
  await db.delete(schema.companies).where(eq(schema.companies.id, co.id)).catch(() => {});
});
