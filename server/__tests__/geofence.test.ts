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

const { haversineMeters, evaluateGeofenceForAddresses, flagClockInGeofence } =
  await import("../services/geofence.js");
const { storage } = await import("../storage.js");

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

// --- flagClockInGeofence: stubs the storage singleton's methods so we can
// assert on the side effects (exception creation + punch linking) without a DB.
function withStubbedStorage(
  opts: {
    addresses: AnyAddr[];
    getThrows?: boolean;
  },
  body: (calls: {
    created: AnyAddr[];
    updates: { id: string; data: AnyAddr }[];
  }) => Promise<void>,
) {
  const orig = {
    getEmployeeGeofencedAddresses: storage.getEmployeeGeofencedAddresses,
    createAttendanceException: storage.createAttendanceException,
    updateAttendanceException: storage.updateAttendanceException,
  };
  const calls = {
    created: [] as AnyAddr[],
    updates: [] as { id: string; data: AnyAddr }[],
  };
  (storage as any).getEmployeeGeofencedAddresses = async () => {
    if (opts.getThrows) throw new Error("boom");
    return opts.addresses;
  };
  (storage as any).createAttendanceException = async (exception: AnyAddr) => {
    const row = { id: "exc-1", ...exception };
    calls.created.push(row);
    return row;
  };
  (storage as any).updateAttendanceException = async (
    id: string,
    data: AnyAddr,
  ) => {
    calls.updates.push({ id, data });
    return { id, ...data };
  };
  return body(calls).finally(() => {
    Object.assign(storage, orig);
  });
}

const baseArgs = {
  userId: "u1",
  punchLogId: "p1",
  workDate: "2026-06-15",
  punchTime: new Date("2026-06-15T09:00:00Z"),
};

test("flagClockInGeofence creates pending exception + links punch when out of bounds", async () => {
  await withStubbedStorage({ addresses: [addr()] }, async (calls) => {
    const result = await flagClockInGeofence({
      ...baseArgs,
      punchLatitude: 40.01, // ~1.1km away, outside 150m
      punchLongitude: -75.0,
    });
    assert.equal(result?.withinRadius, false);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].type, "geofence");
    assert.equal(calls.created[0].status, "pending");
    assert.equal(calls.created[0].employeeId, "u1");
    // punchLogId is set via the follow-up update, not the insert.
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.updates[0].id, "exc-1");
    assert.equal(calls.updates[0].data.punchLogId, "p1");
  });
});

test("flagClockInGeofence creates exception when geofence required but GPS missing", async () => {
  await withStubbedStorage({ addresses: [addr()] }, async (calls) => {
    const result = await flagClockInGeofence({
      ...baseArgs,
      punchLatitude: null,
      punchLongitude: null,
    });
    assert.equal(result?.coordsMissing, true);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].type, "geofence");
  });
});

test("flagClockInGeofence does NOT create an exception when within radius", async () => {
  await withStubbedStorage({ addresses: [addr()] }, async (calls) => {
    const result = await flagClockInGeofence({
      ...baseArgs,
      punchLatitude: 40.00012, // ~13m away, inside 150m
      punchLongitude: -75.0,
    });
    assert.equal(result?.withinRadius, true);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.updates.length, 0);
  });
});

test("flagClockInGeofence does NOT create an exception when no geofence configured", async () => {
  await withStubbedStorage(
    { addresses: [addr({ geofenceEnabled: false })] },
    async (calls) => {
      const result = await flagClockInGeofence({
        ...baseArgs,
        punchLatitude: 40.0,
        punchLongitude: -75.0,
      });
      assert.equal(result?.required, false);
      assert.equal(calls.created.length, 0);
    },
  );
});

test("flagClockInGeofence never throws and returns null on storage error", async () => {
  await withStubbedStorage(
    { addresses: [], getThrows: true },
    async (calls) => {
      const result = await flagClockInGeofence({
        ...baseArgs,
        punchLatitude: 40.01,
        punchLongitude: -75.0,
      });
      assert.equal(result, null);
      assert.equal(calls.created.length, 0);
    },
  );
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
