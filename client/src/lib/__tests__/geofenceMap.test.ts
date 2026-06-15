import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGeofenceBbox,
  DEFAULT_GEOFENCE_RADIUS_METERS,
  type GeofenceMapData,
} from "../geofenceMap";

function geo(over: Partial<GeofenceMapData> = {}): GeofenceMapData {
  return {
    punchLatitude: 40.0,
    punchLongitude: -75.0,
    allowedLatitude: 40.0,
    allowedLongitude: -75.0,
    allowedRadiusMeters: DEFAULT_GEOFENCE_RADIUS_METERS,
    allowedLabel: "HQ",
    distanceMeters: 0,
    coordsMissing: false,
    ...over,
  };
}

// --- Missing punch coordinates ---
test("computeGeofenceBbox returns null when the punch has no coordinates", () => {
  assert.equal(
    computeGeofenceBbox(geo({ punchLatitude: null, punchLongitude: null })),
    null,
  );
  // A single missing axis is still "no usable punch point".
  assert.equal(computeGeofenceBbox(geo({ punchLatitude: null })), null);
  assert.equal(computeGeofenceBbox(geo({ punchLongitude: null })), null);
});

// --- Tiny distance → minimum span kicks in ---
test("computeGeofenceBbox enforces a minimum span when punch ≈ allowed point", () => {
  // Punch sits essentially on top of the allowed point with no radius framing,
  // so without a floor the bbox would collapse to a point.
  const bbox = computeGeofenceBbox(
    geo({
      allowedLatitude: 40.0,
      allowedLongitude: -75.0,
      allowedRadiusMeters: 0,
    }),
  )!;
  assert.ok(bbox);
  // ~120m min span + 25% padding on each side ⇒ at least ~120m of latitude.
  const spanMeters = (bbox.maxLat - bbox.minLat) * 111320;
  assert.ok(
    spanMeters >= 120,
    `expected >= 120m latitude span, got ${spanMeters}`,
  );
  // Box is centered on the shared point.
  const midLat = (bbox.maxLat + bbox.minLat) / 2;
  assert.ok(Math.abs(midLat - 40.0) < 1e-9, `midLat ${midLat}`);
});

// --- Allowed point + radius framing ---
test("computeGeofenceBbox frames a far-apart punch and allowed point", () => {
  // Punch ~1.1km north of the allowed point; the box must contain BOTH.
  const punchLat = 40.01;
  const allowedLat = 40.0;
  const bbox = computeGeofenceBbox(
    geo({
      punchLatitude: punchLat,
      punchLongitude: -75.0,
      allowedLatitude: allowedLat,
      allowedLongitude: -75.0,
      allowedRadiusMeters: 150,
    }),
  )!;
  assert.ok(bbox);
  // Punch is the northernmost point — it must be inside (below maxLat).
  assert.ok(bbox.maxLat > punchLat, `maxLat ${bbox.maxLat} must exceed punch`);
  // The allowed point expanded south by its radius must be inside (above minLat).
  const allowedSouthEdge = allowedLat - 150 / 111320;
  assert.ok(
    bbox.minLat < allowedSouthEdge,
    `minLat ${bbox.minLat} must sit below the allowed radius edge`,
  );
});

test("computeGeofenceBbox without an allowed point still frames the punch with min span", () => {
  const bbox = computeGeofenceBbox(
    geo({
      punchLatitude: 40.0,
      punchLongitude: -75.0,
      allowedLatitude: null,
      allowedLongitude: null,
      allowedRadiusMeters: null,
      distanceMeters: null,
    }),
  )!;
  assert.ok(bbox);
  // No allowed point, so the min-span floor (~120m) drives the frame.
  const spanMeters = (bbox.maxLat - bbox.minLat) * 111320;
  assert.ok(spanMeters >= 120, `got ${spanMeters}`);
  assert.ok(bbox.minLat < 40.0 && bbox.maxLat > 40.0);
  assert.ok(bbox.minLng < -75.0 && bbox.maxLng > -75.0);
});
