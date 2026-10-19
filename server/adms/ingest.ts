// Turns a raw biometric-clock punch into an Ahava punch_log entry.
//
// Scope note (MVP for the Williamsburg bring-up): this mirrors the kiosk's
// in/out model — direction is derived from the employee's current open-punch
// state, not from the device's "status" key — and the punch is recorded at
// server "now" (the clock pushes in realtime), exactly like a kiosk punch. Full
// policy enforcement (allowed-source checks, geofence, enforceClockIn/Out
// rounding, honoring the device-supplied timestamp with the location timezone)
// is deliberately deferred to a later phase so day-one punches are never
// rejected by a half-configured policy. Every raw punch is persisted in
// biometric_device_events regardless, so nothing is lost.
import { storage, DuplicateOpenPunchError } from "../storage";
import { writeLedgerEntry } from "../services/ledger";
import { logger } from "../lib/logger";
import type { BiometricDevice } from "@shared/schema";
import type { AttendancePunch } from "./protocol";
import * as adms from "./store";

export interface IngestResult {
  processed: number;
  duplicates: number;
  pendingMapping: number;
  errors: number;
}

/** Process one device's batch of punches. Never throws — each punch is isolated. */
export async function ingestPunches(
  device: BiometricDevice,
  punches: AttendancePunch[],
): Promise<IngestResult> {
  const result: IngestResult = { processed: 0, duplicates: 0, pendingMapping: 0, errors: 0 };

  for (const punch of punches) {
    try {
      // 1) Idempotency + audit: record the raw event first. A re-send collides
      //    on (device, user, time) and returns null → already handled.
      const event = await adms.insertEventIfNew({
        deviceId: device.id,
        deviceUserId: punch.deviceUserId,
        devicePunchTime: punch.timeRaw,
        deviceStatus: punch.status || null,
        rawLine: punch.rawLine,
      });
      if (!event) {
        result.duplicates += 1;
        continue;
      }

      // 2) Map device user-number → Ahava employee (explicit, else auto by
      //    employeeNumber). Unmapped punches are kept as pending_mapping so a
      //    manager can bind them later — never dropped.
      let userId = await adms.getMappedUserId(device.id, punch.deviceUserId);
      if (!userId) {
        const auto = await adms.autoMatchUserByEmployeeNumber(punch.deviceUserId, device.companyId);
        if (auto) {
          userId = auto;
          await adms.mapDeviceUser(device.id, punch.deviceUserId, auto);
        }
      }
      if (!userId) {
        await adms.updateEvent(event.id, { status: "pending_mapping" });
        result.pendingMapping += 1;
        continue;
      }

      // 3) Derive in/out from current open-punch state and write it.
      const last = await storage.getLatestAttendanceForUser(userId);
      const isOpen = !!(last && last.clockIn && !last.clockOut);

      if (isOpen) {
        const updated = await storage.clockOut(userId);
        if (!updated) {
          // Raced to closed by another path — treat as handled.
          await adms.updateEvent(event.id, { userId, status: "duplicate", direction: "clock_out" });
          result.duplicates += 1;
          continue;
        }
        await safeLedger({
          eventType: "clock_out",
          employeeId: userId,
          entityId: updated.id,
          workDate: updated.workDate,
        });
        await adms.updateEvent(event.id, { userId, punchLogId: updated.id, direction: "clock_out", status: "processed" });
        result.processed += 1;
      } else {
        let record;
        try {
          record = await storage.clockIn(userId, "biometric", undefined, { kioskDeviceId: device.id });
        } catch (err) {
          if (err instanceof DuplicateOpenPunchError) {
            await adms.updateEvent(event.id, { userId, status: "duplicate", direction: "clock_in" });
            result.duplicates += 1;
            continue;
          }
          throw err;
        }
        await safeLedger({
          eventType: "clock_in",
          employeeId: userId,
          entityId: record.id,
          workDate: record.workDate,
        });
        await adms.updateEvent(event.id, { userId, punchLogId: record.id, direction: "clock_in", status: "processed" });
        result.processed += 1;
      }
    } catch (err) {
      result.errors += 1;
      logger.error("Biometric punch ingest failed", {
        source: "adms",
        deviceId: device.id,
        deviceUserId: punch.deviceUserId,
        err,
      });
    }
  }

  return result;
}

// Ledger writes must never block a punch; a failure here is logged, not thrown.
async function safeLedger(args: {
  eventType: "clock_in" | "clock_out";
  employeeId: string;
  entityId: string;
  workDate: string;
}): Promise<void> {
  try {
    await writeLedgerEntry({
      category: "attendance",
      eventType: args.eventType,
      employeeId: args.employeeId,
      actorUserId: args.employeeId,
      entityType: "punch_log",
      entityId: args.entityId,
      workDate: args.workDate,
      beforeValue: null,
      afterValue: null,
      source: "biometric",
    } as any);
  } catch (err) {
    logger.warn("Biometric ledger write failed (non-fatal)", { source: "adms", err });
  }
}
