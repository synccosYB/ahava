/**
 * Company deletion always succeeds and unassigns everything that pointed at the
 * company (owner's spec: deleting a company leaves its employees unassigned,
 * never blocked). storage.deleteCompany nulls every nullable company reference
 * in one transaction, then removes the row.
 *
 * Run with: `tsx server/__tests__/companyDelete.test.ts`  (requires DATABASE_URL)
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const empId = `delemp-${suffix}`;

const company = await storage.createCompany({ name: `DelTest ${suffix}` } as any);
const cleanup: Array<() => Promise<unknown>> = [
  () => db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, empId)),
  () => db.delete(schema.users).where(eq(schema.users.id, empId)),
  () => db.delete(schema.departments).where(eq(schema.departments.companyId, company.id)),
  () => db.delete(schema.companies).where(eq(schema.companies.id, company.id)),
];

try {
  // An employee whose home company AND payroll company is this one.
  await db.insert(schema.users).values({
    id: empId, email: `${empId}@test.local`, firstName: "Del", lastName: "Emp",
    role: "employee", companyId: company.id,
  });
  await db.insert(schema.userEmploymentProfiles).values({
    userId: empId, payrollCompanyId: company.id,
  });
  // A department scoped to the company (nullable reference).
  const [dept] = await db.insert(schema.departments)
    .values({ companyId: company.id, name: `Dept ${suffix}` }).returning();

  // Delete — must succeed even though all of the above reference the company.
  await storage.deleteCompany(company.id);

  // Company is gone.
  const gone = await storage.getCompany(company.id);
  assert.equal(gone, undefined, "company should be deleted");

  // Employee still exists, but is unassigned (home + payroll company cleared).
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, empId));
  assert.ok(u, "employee record must be kept");
  assert.equal(u.companyId, null, "employee home company should be unassigned");
  const [p] = await db.select().from(schema.userEmploymentProfiles)
    .where(eq(schema.userEmploymentProfiles.userId, empId));
  assert.ok(p, "employment profile must be kept");
  assert.equal(p.payrollCompanyId, null, "payroll company should be unassigned");

  // Department kept, unassigned.
  const [d] = await db.select().from(schema.departments).where(eq(schema.departments.id, dept.id));
  assert.ok(d, "department must be kept");
  assert.equal(d.companyId, null, "department company should be unassigned");

  console.log("OK — deleting a company unassigns employees/profiles/departments and removes the row.");
} finally {
  for (const fn of cleanup) {
    try { await fn(); } catch {}
  }
}
process.exit(0);
