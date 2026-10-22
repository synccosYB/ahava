// Task #418 / Note #2: clock-in geofencing.
//
// Two modes, by punch source:
//   * Self-service (phone/web): STRICT. The self-service clock-in route calls
//     evaluateClockInGeofence BEFORE writing a punch and BLOCKS when the device
//     is outside every allowed radius (or shares no location while a geofence is
//     in force). A blocked attempt is recorded as a "geofence" exception for the
//     manager. A manager/admin can override for a stuck employee.
//   * Wall fingerprint clock & on-site kiosk: physical proof of presence — they
//     never geofence.
// The helpers below also still support the legacy flag-only path
// (flagClockInGeofence) which raises a manager-facing exception without blocking;
// it runs after a punch is created (e.g. for an overridden out-of-area punch).

import { storage } from "../storage";
import type { LocationAddress, PunchLog } from "@shared/schema";

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points, in meters.
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export interface GeofenceEvaluation {
  // Whether geofencing applies to this employee at all (any geofenced address).
  required: boolean;
  // True when the punch is within at least one allowed radius.
  withinRadius: boolean;
  // True when geofencing is required but no device coordinates were provided.
  coordsMissing: boolean;
  // Distance (m) to the nearest geofenced address, when coordinates are known.
  nearestDistanceMeters: number | null;
  // Label/name of the nearest geofenced address, for the exception message.
  nearestLabel: string | null;
  // The allowed radius (m) of the nearest geofenced address.
  nearestRadiusMeters: number | null;
  // Coordinates of the nearest geofenced address (for the manager map preview).
  nearestLatitude: number | null;
  nearestLongitude: number | null;
}

// Manager-facing geo payload for the "Out of Area" exception map preview.
export interface GeofenceMapData {
  punchLatitude: number | null;
  punchLongitude: number | null;
  allowedLatitude: number | null;
  allowedLongitude: number | null;
  allowedRadiusMeters: number | null;
  allowedLabel: string | null;
  distanceMeters: number | null;
  coordsMissing: boolean;
}

function addressLabel(addr: LocationAddress): string {
  return (
    addr.label ||
    [addr.address, addr.city, addr.state].filter(Boolean).join(", ") ||
    "geofenced location"
  );
}

// Evaluate a punch against the employee's geofenced addresses. Pure given the
// addresses, so it's easy to reason about and unit-test.
export function evaluateGeofenceForAddresses(
  addresses: LocationAddress[],
  punchLat: number | null | undefined,
  punchLng: number | null | undefined,
): GeofenceEvaluation {
  const geofenced = addresses.filter(
    (a) => a.geofenceEnabled && a.latitude != null && a.longitude != null,
  );

  if (geofenced.length === 0) {
    return {
      required: false,
      withinRadius: true,
      coordsMissing: false,
      nearestDistanceMeters: null,
      nearestLabel: null,
      nearestRadiusMeters: null,
      nearestLatitude: null,
      nearestLongitude: null,
    };
  }

  if (punchLat == null || punchLng == null) {
    return {
      required: true,
      withinRadius: false,
      coordsMissing: true,
      nearestDistanceMeters: null,
      nearestLabel: null,
      nearestRadiusMeters: null,
      nearestLatitude: null,
      nearestLongitude: null,
    };
  }

  let nearest: { distance: number; addr: LocationAddress } | null = null;
  let withinRadius = false;

  for (const addr of geofenced) {
    const distance = haversineMeters(
      punchLat,
      punchLng,
      addr.latitude as number,
      addr.longitude as number,
    );
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, addr };
    }
    const radius = addr.geofenceRadiusMeters ?? 150;
    if (distance <= radius) {
      withinRadius = true;
    }
  }

  return {
    required: true,
    withinRadius,
    coordsMissing: false,
    nearestDistanceMeters: nearest ? Math.round(nearest.distance) : null,
    nearestLabel: nearest ? addressLabel(nearest.addr) : null,
    nearestRadiusMeters: nearest
      ? nearest.addr.geofenceRadiusMeters ?? 150
      : null,
    nearestLatitude: nearest ? (nearest.addr.latitude as number) : null,
    nearestLongitude: nearest ? (nearest.addr.longitude as number) : null,
  };
}

// Build the manager-facing map payload for a single geofence exception, given
// the employee's geofenced addresses and the recorded punch coordinates. Pure
// (no I/O) so the nearest-allowed-coordinate framing is easy to unit-test.
export function buildGeofenceMapData(
  addresses: LocationAddress[],
  punchLat: number | null | undefined,
  punchLng: number | null | undefined,
): GeofenceMapData {
  const evaluation = evaluateGeofenceForAddresses(addresses, punchLat, punchLng);
  return {
    punchLatitude: punchLat ?? null,
    punchLongitude: punchLng ?? null,
    allowedLatitude: evaluation.nearestLatitude,
    allowedLongitude: evaluation.nearestLongitude,
    allowedRadiusMeters: evaluation.nearestRadiusMeters,
    allowedLabel: evaluation.nearestLabel,
    distanceMeters: evaluation.nearestDistanceMeters,
    coordsMissing: evaluation.coordsMissing,
  };
}

// Enrich attendance-exception rows with the geofence map payload. Only "geofence"
// rows that have a linked punch get a payload; every other row (and geofence rows
// without a punch) passes through with geofence: null. Fetches punches and the
// per-employee geofenced addresses in bulk to keep this O(1) round-trips.
export async function attachGeofenceMapToExceptions<
  T extends { type: string; employeeId: string; punchLogId?: string | null },
>(rows: T[]): Promise<Array<T & { geofence: GeofenceMapData | null }>> {
  const geoRows = rows.filter((r) => r.type === "geofence" && r.punchLogId);
  if (geoRows.length === 0) {
    return rows.map((r) => ({ ...r, geofence: null }));
  }
  const punchIds = Array.from(
    new Set(geoRows.map((r) => r.punchLogId as string)),
  );
  const punchList = await Promise.all(
    punchIds.map((id) => storage.getPunchLog(id)),
  );
  const punchById = new Map(
    punchList.filter((p): p is PunchLog => !!p).map((p) => [p.id, p]),
  );
  const employeeIds = Array.from(new Set(geoRows.map((r) => r.employeeId)));
  const addressesByEmployee = new Map<
    string,
    Awaited<ReturnType<typeof storage.getEmployeeGeofencedAddresses>>
  >();
  await Promise.all(
    employeeIds.map(async (id) => {
      addressesByEmployee.set(
        id,
        await storage.getEmployeeGeofencedAddresses(id),
      );
    }),
  );
  return rows.map((r) => {
    if (r.type !== "geofence" || !r.punchLogId) {
      return { ...r, geofence: null };
    }
    const punch = punchById.get(r.punchLogId);
    const geofence = buildGeofenceMapData(
      addressesByEmployee.get(r.employeeId) || [],
      punch?.punchLatitude ?? null,
      punch?.punchLongitude ?? null,
    );
    return { ...r, geofence };
  });
}

// Compose a human-readable reason for the manager-facing exception.
export function buildGeofenceExceptionReason(
  evaluation: GeofenceEvaluation,
  punchLat: number | null | undefined,
  punchLng: number | null | undefined,
): string {
  if (evaluation.coordsMissing) {
    return (
      "Clock-in location could not be verified — the device did not share its " +
      "location while geofencing is required for this employee."
    );
  }
  const coords =
    punchLat != null && punchLng != null
      ? ` (clocked in at ${punchLat.toFixed(5)}, ${punchLng.toFixed(5)})`
      : "";
  const distance =
    evaluation.nearestDistanceMeters != null
      ? `${evaluation.nearestDistanceMeters}m`
      : "an unknown distance";
  const allowed =
    evaluation.nearestRadiusMeters != null
      ? `${evaluation.nearestRadiusMeters}m`
      : "the allowed radius";
  const where = evaluation.nearestLabel
    ? ` from "${evaluation.nearestLabel}"`
    : "";
  return `Clock-in was ${distance}${where}, outside the allowed ${allowed} geofence${coords}.`;
}

// Note #2: evaluate a would-be clock-in against the employee's geofenced
// addresses WITHOUT creating anything. Used by the self-service clock-in path to
// decide whether to BLOCK (strict enforcement) before any punch is written. The
// wall fingerprint clock and on-site kiosk are physical proof of presence and
// never call this.
export async function evaluateClockInGeofence(
  userId: string,
  punchLatitude: number | null | undefined,
  punchLongitude: number | null | undefined,
): Promise<GeofenceEvaluation> {
  const addresses = await storage.getEmployeeGeofencedAddresses(userId);
  return evaluateGeofenceForAddresses(addresses, punchLatitude, punchLongitude);
}

// Note #2: a human-readable message for a BLOCKED self-service clock-in, telling
// the employee to enable location or walk to the wall clock.
export function buildGeofenceBlockMessage(evaluation: GeofenceEvaluation): string {
  if (evaluation.coordsMissing) {
    return (
      "We couldn't confirm you're at the building. Turn on location for this " +
      "site and try again, or clock in on the wall clock inside the building."
    );
  }
  const distance =
    evaluation.nearestDistanceMeters != null ? `${evaluation.nearestDistanceMeters}m away` : "too far away";
  const where = evaluation.nearestLabel ? ` from ${evaluation.nearestLabel}` : "";
  return (
    `You're ${distance}${where} — outside your work location, so you can't clock ` +
    "in from your phone here. Clock in on the wall clock inside the building."
  );
}

// Note #2: record a BLOCKED out-of-area attempt as a pending "geofence"
// attendance exception (no linked punch, since none was created) so a manager
// sees that someone tried to clock in from the wrong place. Never throws.
export async function recordGeofenceBlockedAttempt(args: {
  userId: string;
  workDate: string;
  punchTime: Date;
  evaluation: GeofenceEvaluation;
  punchLatitude: number | null | undefined;
  punchLongitude: number | null | undefined;
}): Promise<void> {
  try {
    const base = buildGeofenceExceptionReason(args.evaluation, args.punchLatitude, args.punchLongitude);
    await storage.createAttendanceException({
      employeeId: args.userId,
      exceptionDate: args.workDate,
      exceptionTime: args.punchTime,
      type: "geofence",
      reason: `BLOCKED — phone clock-in denied. ${base}`,
      status: "pending",
    });
  } catch (err) {
    console.error("Failed to record geofence blocked attempt:", err);
  }
}

// Run the full geofence check for a clock-in and, when out of bounds (or
// required-but-missing), raise a pending "geofence" attendance exception linked
// to the punch. Never throws on evaluation problems — geofencing must not be
// able to break a clock-in.
export async function flagClockInGeofence(args: {
  userId: string;
  punchLogId: string;
  workDate: string;
  punchTime: Date;
  punchLatitude: number | null | undefined;
  punchLongitude: number | null | undefined;
}): Promise<GeofenceEvaluation | null> {
  try {
    const addresses = await storage.getEmployeeGeofencedAddresses(args.userId);
    const evaluation = evaluateGeofenceForAddresses(
      addresses,
      args.punchLatitude,
      args.punchLongitude,
    );

    if (!evaluation.required || evaluation.withinRadius) {
      return evaluation;
    }

    const reason = buildGeofenceExceptionReason(
      evaluation,
      args.punchLatitude,
      args.punchLongitude,
    );

    const created = await storage.createAttendanceException({
      employeeId: args.userId,
      exceptionDate: args.workDate,
      exceptionTime: args.punchTime,
      type: "geofence",
      reason,
      status: "pending",
    });

    // punchLogId is omitted from the insert schema (employees can't set it), so
    // link the punch in a follow-up update.
    if (created?.id) {
      await storage.updateAttendanceException(created.id, {
        punchLogId: args.punchLogId,
      });
    }

    return evaluation;
  } catch (err) {
    console.error("Geofence flagging failed (clock-in still succeeded):", err);
    return null;
  }
}
