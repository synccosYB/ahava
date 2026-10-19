// Data access for biometric wall clocks. Kept in its own module (reading `db`
// directly, the same way server/storage.ts does) so the large IStorage surface
// doesn't have to grow for this feature.
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  biometricDevices,
  biometricDeviceUsers,
  biometricDeviceEvents,
  userEmploymentProfiles,
  users,
  type BiometricDevice,
  type BiometricDeviceEvent,
  type InsertBiometricDevice,
} from "@shared/schema";

export async function getDeviceBySerial(serial: string): Promise<BiometricDevice | undefined> {
  const [row] = await db
    .select()
    .from(biometricDevices)
    .where(eq(biometricDevices.serialNumber, serial))
    .limit(1);
  return row;
}

export async function getDevice(id: string): Promise<BiometricDevice | undefined> {
  const [row] = await db.select().from(biometricDevices).where(eq(biometricDevices.id, id)).limit(1);
  return row;
}

export async function listDevices(): Promise<BiometricDevice[]> {
  return db.select().from(biometricDevices).orderBy(desc(biometricDevices.createdAt));
}

export async function createDevice(input: InsertBiometricDevice): Promise<BiometricDevice> {
  const [row] = await db.insert(biometricDevices).values(input).returning();
  return row;
}

export async function touchDeviceLastSeen(deviceId: string, firmware?: string | null): Promise<void> {
  await db
    .update(biometricDevices)
    .set({ lastSeenAt: new Date(), ...(firmware ? { firmware } : {}) })
    .where(eq(biometricDevices.id, deviceId));
}

/** Explicit mapping: the device's local user-number → Ahava user id. */
export async function getMappedUserId(deviceId: string, deviceUserId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: biometricDeviceUsers.userId })
    .from(biometricDeviceUsers)
    .where(and(eq(biometricDeviceUsers.deviceId, deviceId), eq(biometricDeviceUsers.deviceUserId, deviceUserId)))
    .limit(1);
  return row?.userId;
}

/**
 * Convenience auto-match used when there is no explicit mapping yet: if an
 * employee's `employeeNumber` equals the device's user-number we can bind them
 * automatically. Scoped to the device's company when known to avoid cross-company
 * collisions; a non-unique match returns nothing (caller leaves it pending).
 */
export async function autoMatchUserByEmployeeNumber(
  deviceUserId: string,
  companyId: string | null,
): Promise<string | undefined> {
  const rows = await db
    .select({ userId: userEmploymentProfiles.userId, companyId: users.companyId })
    .from(userEmploymentProfiles)
    .innerJoin(users, eq(users.id, userEmploymentProfiles.userId))
    .where(eq(userEmploymentProfiles.employeeNumber, deviceUserId));
  // Never auto-bind an employee from a different company simply because the
  // employee number happens to be globally unique.
  const eligible = companyId ? rows.filter((r) => r.companyId === companyId) : rows;
  return eligible.length === 1 ? eligible[0].userId : undefined;
}

export async function mapDeviceUser(deviceId: string, deviceUserId: string, userId: string): Promise<void> {
  await db
    .insert(biometricDeviceUsers)
    .values({ deviceId, deviceUserId, userId })
    .onConflictDoUpdate({
      target: [biometricDeviceUsers.deviceId, biometricDeviceUsers.deviceUserId],
      set: { userId },
    });
}

/**
 * Insert a device event idempotently. The unique (device, user, time) key means
 * a re-sent punch collides and returns no row — the signal that we've already
 * processed it. Returns the created event, or null if it was a duplicate.
 */
export async function insertEventIfNew(values: {
  deviceId: string;
  deviceUserId: string;
  devicePunchTime: string;
  deviceStatus?: string | null;
  rawLine?: string | null;
}): Promise<BiometricDeviceEvent | null> {
  const [row] = await db
    .insert(biometricDeviceEvents)
    .values({ ...values, status: "pending" })
    .onConflictDoNothing({
      target: [
        biometricDeviceEvents.deviceId,
        biometricDeviceEvents.deviceUserId,
        biometricDeviceEvents.devicePunchTime,
      ],
    })
    .returning();
  return row ?? null;
}

export async function updateEvent(
  id: string,
  patch: Partial<Pick<BiometricDeviceEvent, "userId" | "punchLogId" | "direction" | "status" | "error">>,
): Promise<void> {
  await db.update(biometricDeviceEvents).set(patch).where(eq(biometricDeviceEvents.id, id));
}

export async function listEvents(deviceId: string, limit = 50): Promise<BiometricDeviceEvent[]> {
  return db
    .select()
    .from(biometricDeviceEvents)
    .where(eq(biometricDeviceEvents.deviceId, deviceId))
    .orderBy(desc(biometricDeviceEvents.createdAt))
    .limit(limit);
}
