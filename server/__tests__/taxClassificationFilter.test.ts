/**
 * Unit test for the tax_classification filter on /api/reports/generate
 * and the per-employee storage round-trip (W-2 default, 1099 update).
 *
 * Run with: `tsx server/__tests__/taxClassificationFilter.test.ts`
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");
const { eq } = await import("drizzle-orm");

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function makeEmployee(suffix: string) {
  const id = `tc-${suffix}-${stamp}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Tax",
    lastName: suffix,
    role: "employee",
    status: "active",
  });
  return id;
}

const w2Id = await makeEmployee("w2");
const c1099Id = await makeEmployee("c1099");
const defaultId = await makeEmployee("def");

try {
  // 1) Default classification is W-2 when none provided.
  await storage.createEmploymentProfile({ userId: defaultId });
  const defProfile = await storage.getEmploymentProfile(defaultId);
  assert.equal(defProfile?.taxClassification, "W-2", "missing taxClassification must default to W-2");

  // 2) Explicit W-2 round-trips.
  await storage.createEmploymentProfile({ userId: w2Id, taxClassification: "W-2" });
  const w2Profile = await storage.getEmploymentProfile(w2Id);
  assert.equal(w2Profile?.taxClassification, "W-2");

  // 3) 1099 round-trips and can be updated from W-2.
  await storage.createEmploymentProfile({ userId: c1099Id, taxClassification: "W-2" });
  await storage.updateEmploymentProfile(c1099Id, { taxClassification: "1099" });
  const c1099Profile = await storage.getEmploymentProfile(c1099Id);
  assert.equal(c1099Profile?.taxClassification, "1099", "must persist 1099 after update");

  // 4) Filter logic: same shape as /api/reports/generate.
  const allIds = [w2Id, c1099Id, defaultId];
  const profilesByUser = new Map<string, { taxClassification: string }>();
  for (const id of allIds) {
    const p = await storage.getEmploymentProfile(id);
    profilesByUser.set(id, { taxClassification: p?.taxClassification || "W-2" });
  }

  function filterByTax(taxClassifications: string[]): string[] {
    const set = new Set(taxClassifications);
    return allIds.filter((id) =>
      set.has(profilesByUser.get(id)?.taxClassification || "W-2"),
    );
  }

  assert.deepEqual(filterByTax(["W-2"]).sort(), [w2Id, defaultId].sort(), "W-2 filter must include explicit + default");
  assert.deepEqual(filterByTax(["1099"]), [c1099Id], "1099 filter must isolate 1099 worker");
  assert.deepEqual(filterByTax(["W-2", "1099"]).sort(), allIds.slice().sort(), "both classifications must return all");

  console.log("✓ taxClassificationFilter: all assertions passed");
} finally {
  // Cleanup
  for (const id of [w2Id, c1099Id, defaultId]) {
    await db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

process.exit(0);
