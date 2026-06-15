/**
 * Self-contained sanity tests for clock-in geofencing (Task #418).
 *
 * Run with: `tsx server/__tests__/geofence.test.ts`
 *
 * No external test runner — asserts inline and exits non-zero on first failure
 * so it can be wired into CI without adding a dev-dep to package.json.
 *
 * Covers the pure evaluation logic only (Haversine + radius decision). The
 * decision must be correct because geofencing never blocks a clock-in — it only
 * decides whether to raise a manager-facing "geofence" exception, so a wrong
 * decision silently misses (or fabricates) out-of-area alerts.
 */
import assert from "node:assert/strict";

const { haversineMeters, evaluateGeofenceForAddresses } = await import(
  "../services/geofence.js"
);

type AnyAddr = any;

function addr(over: Partial<AnyAddr> = {}): AnyAddr {
  return {
    id: "a1",
    label: "HQ",
    address: "1 Main St",
    city: "Town",
    state: "CA",
    latitude: 40.0,
    longitude: -75.0,
    geofenceEnabled: true,
    geofenceRadiusMeters: 150,
    ...over,
  };
}

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// --- Haversine ---
test("haversine returns ~0 for identical points", () => {
  assert.ok(haversineMeters(40, -75, 40, -75) < 1e-6);
});

test("haversine ~111km for 1 degree of latitude", () => {
  const d = haversineMeters(40, -75, 41, -75);
  assert.ok(Math.abs(d - 111195) < 500, `got ${d}`);
});

// --- Evaluation: no geofence configured ---
test("no geofenced addresses → not required, within", () => {
  const r = evaluateGeofenceForAddresses(
    [addr({ geofenceEnabled: false })],
    40.0,
    -75.0,
  );
  assert.equal(r.required, false);
  assert.equal(r.withinRadius, true);
  assert.equal(r.coordsMissing, false);
});

test("geofence enabled but address missing coords → not required", () => {
  const r = evaluateGeofenceForAddresses(
    [addr({ latitude: null, longitude: null })],
    40.0,
    -75.0,
  );
  assert.equal(r.required, false);
});

// --- Evaluation: required but missing device GPS (the regressed case) ---
test("required + null device coords → coordsMissing, not within", () => {
  const r = evaluateGeofenceForAddresses([addr()], null, null);
  assert.equal(r.required, true);
  assert.equal(r.coordsMissing, true);
  assert.equal(r.withinRadius, false);
});

// --- Evaluation: inside radius ---
test("punch inside radius → within", () => {
  // ~13m north of HQ, well inside 150m.
  const r = evaluateGeofenceForAddresses([addr()], 40.00012, -75.0);
  assert.equal(r.required, true);
  assert.equal(r.withinRadius, true);
  assert.equal(r.coordsMissing, false);
});

// --- Evaluation: outside radius ---
test("punch outside radius → not within, reports distance/label/radius", () => {
  // ~1.1km north of HQ, far outside 150m.
  const r = evaluateGeofenceForAddresses([addr()], 40.01, -75.0);
  assert.equal(r.required, true);
  assert.equal(r.withinRadius, false);
  assert.equal(r.coordsMissing, false);
  assert.ok((r.nearestDistanceMeters ?? 0) > 150);
  assert.equal(r.nearestRadiusMeters, 150);
  assert.equal(r.nearestLabel, "HQ");
});

// --- Evaluation: within ANY of multiple geofenced addresses ---
test("inside one of several geofenced addresses → within", () => {
  const r = evaluateGeofenceForAddresses(
    [addr({ id: "far", latitude: 41, longitude: -75 }), addr({ id: "near" })],
    40.00012,
    -75.0,
  );
  assert.equal(r.withinRadius, true);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok  ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  FAIL  ${t.name}\n        ${err.stack || err.message}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} FAILED` : ""}`);
  if (failed > 0) process.exit(1);
})();
