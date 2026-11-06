// Turns a raw biometric-clock punch into an Ahava punch_log entry.
//
// Scope note (MVP for the Williamsburg bring-up): this mirrors the kiosk's
// in/out model — direction is derived from the employee's current open-punch
// state, not from the device's "status" key. The punch is recorded at the
// DEVICE's own reported time (converted from the clock's local wall-clock
// string to UTC in the employee's location timezone), falling back to server
// "now" only if that string is unparseable — so a push that arrives late no
// longer skews the recorded time. The rest of policy enforcement (allowed-
// source checks, geofence, enforceClockIn/Out rounding) is deliberately
// deferred to a later phase so day-one punches are never rejected by a
// half-configured policy. Every raw punch is persisted in
// biometric_device_events regardless, so nothing is lost.
import { storage, DuplicateOpenPunchError } from "../storage";
import { localWorkDate, resolveEmployeeTimezone } from "../services/punchOverlap";
import { capStaleOpenShiftAtMaxShift, markOpenShiftMissing } from "../services/policyEnforcement";
import { writeLedgerEntry } from "../services/ledger";
import { MISSING_CLOCKIN_STATUS } from "../punchHours";
import { logger } from "../lib/logger";
import type { BiometricDevice } from "@shared/schema";
import { parseDevicePunchTime, deviceDirection, type AttendancePunch } from "./protocol";
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

      // 3) Resolve the punch instant from the DEVICE's own reported time. The
      //    clock reports local wall-clock time (what its screen shows — Eastern
      //    for every Ahava site), so we convert it to UTC in the employee's
      //    location timezone. This is what the person physically punched; we
      //    fall back to server "now" only if the string is unparseable, so a
      //    sync delay no longer skews the recorded time.
      const tz = await resolveEmployeeTimezone(userId);
      const punchAt = parseDevicePunchTime(punch.timeRaw, tz) ?? new Date();

      // 4) Decide direction. By default it's derived from the current open-punch
      //    state (the device status key is ignored). For an employee set to trust
      //    the clock's In/Out key, the device tells us the direction instead — so
      //    one forgotten punch no longer flips every punch after it.
      const last = await storage.getLatestAttendanceForUser(userId);
      let isOpen = !!(last && last.clockIn && !last.clockOut);

      // Guard: if the open shift already ran past the max-shift limit (or crosses
      // a day for a non-overnight employee), the employee forgot to punch out.
      // Cap the stale shift at the max and flag it; this punch then starts fresh.
      if (isOpen) {
        const capped = await capStaleOpenShiftAtMaxShift(userId, punchAt);
        if (capped) isOpen = false;
      }

      const wantDir = (await storage.usesDevicePunchDirection(userId))
        ? deviceDirection(punch.status)
        : null;

      // Device says the employee is clocking IN while a shift is still open → a
      // forgotten punch-out. Cap that open shift as a missing punch so this punch
      // opens a fresh shift (don't close the old one with it).
      if (wantDir === "in" && isOpen) {
        await markOpenShiftMissing(userId, punchAt);
        isOpen = false;
      }

      if (wantDir === "out" && !isOpen) {
        // Device reported a CLOCK-OUT with no open shift → the employee forgot to
        // clock in. Record a clock-out-only MISSING PUNCH (not a new clock-in).
        const record = await storage.createPunchLog({
          employeeId: userId,
          workDate: localWorkDate(punchAt, tz),
          clockIn: null,
          clockOut: punchAt,
          roundedClockOut: punchAt,
          hoursWorked: null,
          status: MISSING_CLOCKIN_STATUS,
          source: "biometric",
          approved: true,
        });
        const ex = await storage.createAttendanceException({
          employeeId: userId,
          exceptionDate: record.workDate,
          exceptionTime: punchAt,
          type: "missing_clockin",
          reason:
            "The clock reported a clock-out with no open shift — the employee forgot to clock in. " +
            "Recorded as a MISSING PUNCH; enter the real clock-in to record the hours.",
          status: "pending",
        }).catch(() => null);
        if (ex?.id) await storage.updateAttendanceException(ex.id, { punchLogId: record.id }).catch(() => {});
        await safeLedger({ eventType: "clock_out", employeeId: userId, entityId: record.id, workDate: record.workDate });
        await adms.updateEvent(event.id, { userId, punchLogId: record.id, direction: "clock_out", status: "processed" });
        result.processed += 1;
        continue;
      }

      // Clock-OUT when: device says "out" (and a shift is open), or no device
      // direction and a shift is open. Otherwise it's a clock-IN.
      const doClockOut = wantDir === "out" || (wantDir === null && isOpen);

      if (doClockOut) {
        const updated = await storage.clockOut(userId, punchAt);
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
          // Biometric clocks have their own table and must not be written to
          // punch_logs.kiosk_device_id (FK references kiosk_devices only).
          // Device provenance is stored in biometric_device_events.punch_log_id.
          // File under the location-local day of the DEVICE punch time (not UTC,
          // and not server-arrival time) so an evening Eastern punch isn't
          // rolled onto the next calendar day, and record the punch at the
          // device's own reported instant.
          record = await storage.clockIn(userId, "biometric", undefined, {
            workDate: localWorkDate(punchAt, tz),
            at: punchAt,
          });
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
