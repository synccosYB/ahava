// Task #418: clock-in geofencing.
//
// Geofencing NEVER blocks a clock-in. It only decides whether a punch happened
// inside an allowed radius of one of the employee's geofenced location
// addresses; when it didn't (or when the device gave us no coordinates while a
// geofence is in force), we raise a "geofence" attendance exception for a
// manager to review. The punch always succeeds.

import { storage } from "../storage";
import type { LocationAddress } from "@shared/schema";

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
