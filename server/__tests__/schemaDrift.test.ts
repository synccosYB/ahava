/**
 * Drift guard: the post-migration check derives its required tables/columns
 * from the Drizzle models in `shared/schema.ts` (NOT a hand-maintained list),
 * so adding a column to a model without a migration must be caught at boot.
 *
 * Run with: `tsx server/__tests__/schemaDrift.test.ts`
 *
 * No external test runner — script asserts inline and exits non-zero on first
 * failure so it can be wired into CI without adding a dev-dep to package.json.
 */
import assert from "node:assert/strict";
import { getExpectedSchema, computeDrift } from "../schemaDrift";

const expected = getExpectedSchema();

// 1. The expected shape is derived from the real models — sanity-check that a
//    broad set of known tables/columns are present (not an empty/partial list).
assert.ok(
  expected.size >= 50,
  `Expected the Drizzle schema to define at least 50 tables, got ${expected.size}. ` +
    `getExpectedSchema() is probably not picking up the pgTable exports.`,
);
for (const table of ["punch_logs", "kiosk_devices", "attendance_exceptions", "users", "companies"]) {
  assert.ok(expected.has(table), `Expected model table "${table}" to be derived from shared/schema.ts.`);
}
assert.ok(
  expected.get("punch_logs")!.has("kiosk_device_id"),
  "Expected punch_logs.kiosk_device_id to be derived from the model.",
);
assert.ok(
  expected.get("kiosk_devices")!.has("pairing_code"),
  "Expected kiosk_devices.pairing_code to be derived from the model.",
);

// The migration-runner bookkeeping table is runtime-only and must NOT be
// treated as part of the model shape.
assert.ok(!expected.has("_migration_log"), "_migration_log must be excluded from the expected model shape.");

// Build a "database mirrors the models exactly" baseline.
const allTables = new Set(expected.keys());
const allColumns = new Map<string, Set<string>>(
  Array.from(expected, ([table, cols]) => [table, new Set(cols)]),
);

// 2. No drift when the database matches the models.
const clean = computeDrift(expected, allTables, allColumns);
assert.deepEqual(clean.missingTables, [], "Expected no missing tables when DB mirrors the models.");
assert.deepEqual(clean.missingColumns, [], "Expected no missing columns when DB mirrors the models.");

// 3. A model column with no matching migration (DB missing the column) is caught.
const colsMissingOne = new Map<string, Set<string>>(
  Array.from(expected, ([table, cols]) => [table, new Set(cols)]),
);
colsMissingOne.get("punch_logs")!.delete("kiosk_device_id");
const colDrift = computeDrift(expected, allTables, colsMissingOne);
assert.deepEqual(
  colDrift.missingColumns,
  ["punch_logs.kiosk_device_id"],
  "Expected a missing model column to be reported as drift.",
);
assert.deepEqual(colDrift.missingTables, [], "A missing column must not be reported as a missing table.");

// 4. A model table with no matching migration (DB missing the table) is caught.
const tablesMissingOne = new Set(allTables);
tablesMissingOne.delete("kiosk_devices");
const tableDrift = computeDrift(expected, tablesMissingOne, allColumns);
assert.ok(
  tableDrift.missingTables.includes("kiosk_devices"),
  "Expected a missing model table to be reported as drift.",
);
// Columns of a missing table should not also be double-reported as missing columns.
assert.ok(
  !tableDrift.missingColumns.some((c) => c.startsWith("kiosk_devices.")),
  "Columns of a missing table must not be double-reported as missing columns.",
);

console.log(
  `OK — schema drift guard derives ${expected.size} tables from shared/schema.ts; ` +
    `clean DB passes, missing column and missing table both fail loudly.`,
);
