// Data access for biometric wall clocks. Kept in its own module (reading `db`
// directly, the same way server/storage.ts does) so the large IStorage surface
// doesn't have to grow for this feature.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  biometricDevices,
  biometricDeviceUsers,
  biometricDeviceEvents,
  biometricDeviceCommands,
  fingerprintTemplates,
  userEmploymentProfiles,
  users,
  type BiometricDevice,
  type BiometricDeviceEvent,
  type BiometricDeviceCommand,
  type InsertBiometricDevice,
} from "@shared/schema";
import { encryptTemplate, decryptTemplate } from "../services/biometricEncryption";

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

// --- Fingerprint cloud brain: command queue (Phase 2) ----------------------

/** Queue a command for a device; it's handed to the clock on its next poll. */
export async function enqueueCommand(deviceId: string, command: string): Promise<BiometricDeviceCommand> {
  const [row] = await db
    .insert(biometricDeviceCommands)
    .values({ deviceId, command })
    .returning();
  return row;
}

/**
 * Pull the device's next pending commands and mark them sent. Returns them so
 * the caller can serialize onto the wire as `C:<seq>:<command>`.
 */
export async function takePendingCommands(deviceId: string, limit = 10): Promise<BiometricDeviceCommand[]> {
  const pending = await db
    .select()
    .from(biometricDeviceCommands)
    .where(and(eq(biometricDeviceCommands.deviceId, deviceId), eq(biometricDeviceCommands.status, "pending")))
    .orderBy(biometricDeviceCommands.seq)
    .limit(limit);
  if (pending.length > 0) {
    await db
      .update(biometricDeviceCommands)
      .set({ status: "sent", sentAt: new Date() })
      .where(inArray(biometricDeviceCommands.id, pending.map((c) => c.id)));
  }
  return pending;
}

/** Record a command result reported by the device (by wire seq). */
export async function ackCommand(seq: number, result: string): Promise<void> {
  await db
    .update(biometricDeviceCommands)
    .set({ status: "acked", result, ackedAt: new Date() })
    .where(eq(biometricDeviceCommands.seq, seq));
}

// --- Fingerprint cloud brain: template storage (Phase 2 Harvest) -----------

/**
 * Store (or refresh) one harvested fingerprint template, encrypted at rest.
 * Upserts on (sourceDevice, PIN, finger) so re-harvesting the same clock is
 * idempotent. `userId`/`companyId` bind it to the Ahava employee when known.
 */
export async function storeFingerprintTemplate(input: {
  sourceDeviceId: string;
  devicePin: string;
  fingerIndex: number;
  template: string;
  size: number | null;
  valid: boolean;
  format: string;
  userId: string | null;
  companyId: string | null;
}): Promise<void> {
  const encrypted = encryptTemplate(input.template);
  await db
    .insert(fingerprintTemplates)
    .values({
      sourceDeviceId: input.sourceDeviceId,
      devicePin: input.devicePin,
      fingerIndex: input.fingerIndex,
      templateData: encrypted,
      templateFormat: input.format,
      size: input.size,
      valid: input.valid,
      userId: input.userId,
      companyId: input.companyId,
    })
    .onConflictDoUpdate({
      target: [
        fingerprintTemplates.sourceDeviceId,
        fingerprintTemplates.devicePin,
        fingerprintTemplates.fingerIndex,
      ],
      set: {
        templateData: encrypted,
        templateFormat: input.format,
        size: input.size,
        valid: input.valid,
        userId: input.userId,
        companyId: input.companyId,
        updatedAt: new Date(),
      },
    });
}

/** How many fingerprint templates we've harvested from a given device. */
export async function countFingerprintsForDevice(deviceId: string): Promise<number> {
  const rows = await db
    .select({ id: fingerprintTemplates.id })
    .from(fingerprintTemplates)
    .where(eq(fingerprintTemplates.sourceDeviceId, deviceId));
  return rows.length;
}

// --- Fingerprint cloud brain: Distribute (Phase 2) -------------------------

export interface DistributableTemplate {
  userId: string;
  pin: string; // consistent target PIN: employee number when set, else source PIN
  name: string;
  fingerIndex: number;
  template: string; // decrypted base64 vendor blob
  size: number | null;
  valid: boolean;
  format: string;
}

/**
 * The templates to push onto a target clock: every fingerprint that's mapped to
 * an employee (optionally scoped to a company). The target PIN is the employee's
 * Employee Number when present (so punches auto-attribute everywhere) — otherwise
 * the original source PIN. Templates are decrypted here for the outgoing command.
 */
export async function getDistributableTemplates(companyId: string | null): Promise<DistributableTemplate[]> {
  const conditions = [isNotNull(fingerprintTemplates.userId)];
  if (companyId) conditions.push(eq(users.companyId, companyId));
  const rows = await db
    .select({
      userId: fingerprintTemplates.userId,
      devicePin: fingerprintTemplates.devicePin,
      fingerIndex: fingerprintTemplates.fingerIndex,
      templateData: fingerprintTemplates.templateData,
      templateFormat: fingerprintTemplates.templateFormat,
      size: fingerprintTemplates.size,
      valid: fingerprintTemplates.valid,
      employeeNumber: userEmploymentProfiles.employeeNumber,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(fingerprintTemplates)
    .innerJoin(users, eq(users.id, fingerprintTemplates.userId))
    .leftJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, fingerprintTemplates.userId))
    .where(and(...conditions));

  const out: DistributableTemplate[] = [];
  for (const r of rows) {
    let template: string;
    try {
      template = decryptTemplate<string>(r.templateData);
    } catch {
      continue; // skip anything we can't decrypt rather than push garbage
    }
    out.push({
      userId: r.userId as string,
      pin: (r.employeeNumber && r.employeeNumber.trim()) || r.devicePin,
      name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
      fingerIndex: r.fingerIndex,
      template,
      size: r.size,
      valid: r.valid,
      format: r.templateFormat || "FP",
    });
  }
  return out;
}
