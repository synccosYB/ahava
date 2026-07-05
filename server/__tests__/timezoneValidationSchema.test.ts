/**
 * Schema-level regression coverage for the timezone guard (task #518).
 *
 * Task #514/#516 added the guard to the company & location SAVE routes by
 * calling `normalizeTimezoneField` inside each handler. That left the guard
 * per-route: any NEW write path (or a table that later grows a `timezone`
 * column) could silently persist a malformed value if the author forgot to call
 * the helper. Task #518 moves the guard down to the shared insert schemas
 * (`timezoneFieldSchema` applied to `insertCompanySchema` / `insertLocationSchema`)
 * so it runs at PARSE time for EVERY consumer of the schema — routes, imports,
 * and any future surface — with no per-route wiring.
 *
 * These tests exercise the schemas directly (no DB, no HTTP) so they prove the
 * guard is bypass-proof at the source of truth. HTTP-level coverage of the four
 * company/location routes lives in timezoneValidationRoute.test.ts.
 *
 * Run with: `npx tsx server/__tests__/timezoneValidationSchema.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCompanySchema, insertLocationSchema, timezoneFieldSchema } from "@shared/schema";

const MALFORMED = "America/New york"; // recoverable: bad separator/case
const CANONICAL = "America/New_York";
const GARBAGE = "Not/ARealZone"; // unrecoverable: must be rejected

test("timezoneFieldSchema coerces a recoverable zone to canonical form", () => {
  const r = timezoneFieldSchema.safeParse(MALFORMED);
  assert.ok(r.success);
  assert.equal(r.data, CANONICAL);
});

test("timezoneFieldSchema rejects an unrecoverable zone", () => {
  const r = timezoneFieldSchema.safeParse(GARBAGE);
  assert.equal(r.success, false);
});

test("timezoneFieldSchema allows blank / null / undefined (falls back downstream)", () => {
  for (const blank of ["", null, undefined]) {
    const r = timezoneFieldSchema.safeParse(blank);
    assert.ok(r.success, `expected ${JSON.stringify(blank)} to pass through`);
  }
});

// The company & location insert schemas (and their .partial() form used by
// PATCH) MUST inherit the guard so no write path can persist a bad zone.
for (const [label, schema, base] of [
  ["company", insertCompanySchema, { name: "tz-schema-test" }],
  ["location", insertLocationSchema, { name: "tz-schema-test", companyId: "c1" }],
] as const) {
  test(`${label} insert schema coerces a malformed timezone`, () => {
    const r = schema.safeParse({ ...base, timezone: MALFORMED });
    assert.ok(r.success, `expected coercion, got ${JSON.stringify((r as any).error?.flatten?.())}`);
    assert.equal(r.data.timezone, CANONICAL);
  });

  test(`${label} insert schema rejects a garbage timezone`, () => {
    const r = schema.safeParse({ ...base, timezone: GARBAGE });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.flatten().fieldErrors.timezone, "expected a timezone field error");
    }
  });

  test(`${label} PATCH (partial) schema coerces a malformed timezone`, () => {
    const r = schema.partial().safeParse({ timezone: MALFORMED });
    assert.ok(r.success, `expected coercion, got ${JSON.stringify((r as any).error?.flatten?.())}`);
    assert.equal(r.data.timezone, CANONICAL);
  });

  test(`${label} PATCH (partial) schema rejects a garbage timezone`, () => {
    const r = schema.partial().safeParse({ timezone: GARBAGE });
    assert.equal(r.success, false);
  });
}
