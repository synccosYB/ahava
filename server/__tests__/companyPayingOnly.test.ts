/**
 * The "paying company only" flag persists on a company (create + update).
 *
 * Run with: `npx tsx server/__tests__/companyPayingOnly.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { companies } from "@shared/schema";
import { storage } from "../storage";

test("payingCompanyOnly defaults false, persists on create and update", async (t) => {
  const stamp = Date.now().toString(36);
  const created = await storage.createCompany({ name: `Paying ${stamp}`, payingCompanyOnly: true } as any);
  const plain = await storage.createCompany({ name: `Plain ${stamp}` });
  t.after(async () => {
    await db.delete(companies).where(inArray(companies.id, [created.id, plain.id])).catch(() => {});
  });

  assert.equal((await storage.getCompany(created.id))?.payingCompanyOnly, true, "set on create");
  assert.equal((await storage.getCompany(plain.id))?.payingCompanyOnly, false, "defaults false");

  await storage.updateCompany(created.id, { payingCompanyOnly: false });
  assert.equal((await storage.getCompany(created.id))?.payingCompanyOnly, false, "cleared on update");
  await storage.updateCompany(plain.id, { payingCompanyOnly: true });
  assert.equal((await storage.getCompany(plain.id))?.payingCompanyOnly, true, "set on update");
});
