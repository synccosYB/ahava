/**
 * Fingerprint enrollment status carries each active employee's location(s) so the
 * report can be searched by location: the primary (home) location is shown, and
 * every location an employee belongs to (primary + extra assignments) is listed
 * for filtering. Fingerprint counts stay correct across the location join.
 *
 * Run with: `npx tsx server/adms/__tests__/enrollmentByLocation.test.ts` (needs DATABASE_URL).
 */
import crypto from "node:crypto";
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { storeFingerprintTemplate, getFingerprintEnrollmentStatus, ENROLL_STATION_SOURCE } from "../store";

const stamp = `fpbyloc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

test("enrollment status includes primary location + all assigned locations", async (t) => {
  const [company] = await db.insert(schema.companies)
    .values({ name: `FP Co ${stamp}` }).returning();
  const companyId = company.id;

  const [locA] = await db.insert(schema.locations)
    .values({ companyId, name: `Loc A ${stamp}` }).returning();
  const [locB] = await db.insert(schema.locations)
    .values({ companyId, name: `Loc B ${stamp}` }).returning();

  // Employee 1: primary location A, one enrolled fingerprint.
  const [emp1] = await db.insert(schema.users)
    .values({ email: `${stamp}-1@example.invalid`, firstName: "Aaa", lastName: `${stamp}1`, role: "employee", companyId, locationId: locA.id })
    .returning();
  await db.insert(schema.userEmploymentProfiles).values({ userId: emp1.id, employeeNumber: `A${stamp.slice(-4)}` });
  await storeFingerprintTemplate({
    sourceDeviceId: ENROLL_STATION_SOURCE, devicePin: `A${stamp.slice(-4)}`, fingerIndex: 1,
    template: "VGVzdA==", size: 512, valid: true, format: "ZKFinger10", userId: emp1.id, companyId,
  });

  // Employee 2: primary location B, ALSO assigned to A (multi-hat), not enrolled.
  const [emp2] = await db.insert(schema.users)
    .values({ email: `${stamp}-2@example.invalid`, firstName: "Bbb", lastName: `${stamp}2`, role: "employee", companyId, locationId: locB.id })
    .returning();
  await db.insert(schema.userEmploymentProfiles).values({ userId: emp2.id, employeeNumber: `B${stamp.slice(-4)}` });
  await db.insert(schema.employeeLocations).values({ userId: emp2.id, locationId: locA.id });

  t.after(async () => {
    await db.delete(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.userId, emp1.id)).catch(() => {});
    await db.delete(schema.employeeLocations).where(eq(schema.employeeLocations.userId, emp2.id)).catch(() => {});
    for (const e of [emp1, emp2]) {
      await db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, e.id)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.id, e.id)).catch(() => {});
    }
    await db.delete(schema.locations).where(eq(schema.locations.id, locA.id)).catch(() => {});
    await db.delete(schema.locations).where(eq(schema.locations.id, locB.id)).catch(() => {});
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId)).catch(() => {});
  });

  const rows = await getFingerprintEnrollmentStatus(companyId);
  const r1 = rows.find((r) => r.userId === emp1.id);
  const r2 = rows.find((r) => r.userId === emp2.id);
  assert.ok(r1 && r2, "both employees present");

  // Employee 1: primary A, enrolled, filterable by A.
  assert.equal(r1!.locationId, locA.id, "emp1 primary location is A");
  assert.equal(r1!.locationName, locA.name, "emp1 location name shown");
  assert.equal(r1!.fingerCount, 1, "emp1 has one fingerprint (count not inflated by join)");
  assert.ok(r1!.locationIds.includes(locA.id), "emp1 filterable by A");

  // Employee 2: primary B, but belongs to BOTH A and B for filtering.
  assert.equal(r2!.locationId, locB.id, "emp2 primary location is B");
  assert.equal(r2!.fingerCount, 0, "emp2 not enrolled");
  assert.ok(r2!.locationIds.includes(locA.id) && r2!.locationIds.includes(locB.id),
    `emp2 should match both A and B, got ${JSON.stringify(r2!.locationIds)}`);
});
