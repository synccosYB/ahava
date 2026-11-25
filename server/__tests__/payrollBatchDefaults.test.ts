/**
 * Saved batch defaults (org-wide singleton): getPayrollBatchDefaults returns an
 * empty/false default before anything is saved, and savePayrollBatchDefaults
 * upserts the location scope + report-split choice idempotently.
 *
 * Run: `npx tsx server/__tests__/payrollBatchDefaults.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, payrollBatchDefaults } from "@shared/schema";
import { storage } from "../storage";

const stamp = `bd-${Date.now().toString(36)}`;

test("batch defaults: default-empty, then save + read round-trips", async (t) => {
  const [admin] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Ada", lastName: stamp, role: "admin",
  }).returning();

  t.after(async () => {
    await db.delete(payrollBatchDefaults).where(eq(payrollBatchDefaults.scope, "global")).catch(() => {});
    await db.delete(users).where(eq(users.id, admin.id)).catch(() => {});
  });

  // Clean slate so the singleton read reflects "never saved".
  await db.delete(payrollBatchDefaults).where(eq(payrollBatchDefaults.scope, "global"));
  const before = await storage.getPayrollBatchDefaults();
  assert.deepEqual(before.locationIds, [], "no saved default → empty locations");
  assert.equal(before.reportSplitByLocation, false, "no saved default → combined");

  // Save a scope of two locations with per-location split.
  await storage.savePayrollBatchDefaults({ locationIds: ["loc-a", "loc-b"], reportSplitByLocation: true }, admin.id);
  const after = await storage.getPayrollBatchDefaults();
  assert.deepEqual(after.locationIds, ["loc-a", "loc-b"], "locations persisted");
  assert.equal(after.reportSplitByLocation, true, "split flag persisted");

  // Upsert again (idempotent on the singleton scope) with a new value.
  await storage.savePayrollBatchDefaults({ locationIds: ["loc-c"], reportSplitByLocation: false }, admin.id);
  const updated = await storage.getPayrollBatchDefaults();
  assert.deepEqual(updated.locationIds, ["loc-c"], "second save replaces, not duplicates");
  assert.equal(updated.reportSplitByLocation, false);

  const rows = await db.select().from(payrollBatchDefaults).where(eq(payrollBatchDefaults.scope, "global"));
  assert.equal(rows.length, 1, "singleton: exactly one row for the global scope");
});
