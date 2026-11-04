/**
 * Auto-assign clock number (= employee number).
 *
 * The clock number a person is enrolled under is the same on every clock, so
 * "next available" = one past the highest NUMERIC number used anywhere it can
 * live: an employee profile, a clock-enrolled user, or a seen punch event.
 * Non-numeric values are ignored; getUserIdByEmployeeNumber finds the owner.
 *
 * Run with: `npx tsx server/__tests__/employeeNumberAutoAssign.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { storage } from "../storage";
import {
  users,
  userEmploymentProfiles,
  biometricDevices,
  biometricDeviceUsers,
  biometricDeviceEvents,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const stamp = `empnum-${Date.now().toString(36)}`;
const createdUserIds: string[] = [];
let deviceId = "";

async function makeUser(employeeNumber: string | null): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `${stamp}-${employeeNumber ?? "none"}-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
      firstName: "Num",
      lastName: stamp,
      role: "employee",
    })
    .returning();
  createdUserIds.push(u.id);
  await db
    .insert(userEmploymentProfiles)
    .values({ userId: u.id, employeeNumber: employeeNumber ?? undefined });
  return u.id;
}

test("getNextEmployeeNumber = highest numeric across profiles + clocks, +1", async (t) => {
  // Independent of existing data: start from whatever the DB already holds.
  const baseline = Number(await storage.getNextEmployeeNumber());
  assert.ok(Number.isFinite(baseline) && baseline >= 1, "baseline is a positive number");

  // Seed numbers well above the current max so the assertion is deterministic.
  const big = baseline + 1000;
  const u1 = await makeUser(String(big)); // numeric profile number
  await makeUser("ABC"); // non-numeric → ignored
  await makeUser(null); // unset → ignored

  // A higher number enrolled on a clock, and an even higher one seen in a punch.
  const [dev] = await db
    .insert(biometricDevices)
    .values({ serialNumber: `SN-${stamp}`, name: `Dev ${stamp}` })
    .returning();
  deviceId = dev.id;
  await db
    .insert(biometricDeviceUsers)
    .values({ deviceId, deviceUserId: String(big + 5), userId: u1 });
  await db
    .insert(biometricDeviceEvents)
    .values({ deviceId, deviceUserId: String(big + 9), devicePunchTime: `t-${stamp}` });

  const next = await storage.getNextEmployeeNumber();
  assert.equal(next, String(big + 10), "next = highest seen (big+9 from an event) + 1");

  // Owner lookup for the uniqueness guard.
  assert.equal(await storage.getUserIdByEmployeeNumber(String(big)), u1, "finds the owner");
  assert.equal(
    await storage.getUserIdByEmployeeNumber(String(big + 777777)),
    undefined,
    "unknown number has no owner",
  );

  t.after(cleanup);
});

async function cleanup() {
  if (deviceId) {
    await db.delete(biometricDeviceEvents).where(eq(biometricDeviceEvents.deviceId, deviceId)).catch(() => {});
    await db.delete(biometricDeviceUsers).where(eq(biometricDeviceUsers.deviceId, deviceId)).catch(() => {});
    await db.delete(biometricDevices).where(eq(biometricDevices.id, deviceId)).catch(() => {});
  }
  if (createdUserIds.length) {
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, createdUserIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
  }
}
