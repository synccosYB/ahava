/**
 * Company deletion guardrails. A company can only be deleted once nothing
 * references it; otherwise storage.getCompanyDeletionBlockers reports the
 * counts the DELETE route turns into a readable 409 (instead of a raw FK 500),
 * and the operational company is never deletable.
 *
 * Run with: `tsx server/__tests__/companyDelete.test.ts`  (requires DATABASE_URL)
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// A throwaway company with nothing pointing at it yet.
const company = await storage.createCompany({ name: `DelTest ${suffix}` } as any);
const cleanup: Array<() => Promise<unknown>> = [
  () => db.delete(schema.companies).where(eq(schema.companies.id, company.id)),
];

try {
  // 1) No references -> all blockers zero.
  let b = await storage.getCompanyDeletionBlockers(company.id);
  assert.deepEqual(b, { employees: 0, payrollPayeeFor: 0, locations: 0, departments: 0 },
    `fresh company should have no blockers, got ${JSON.stringify(b)}`);

  // 2) A location pointing at it is counted.
  const [loc] = await db.insert(schema.locations)
    .values({ companyId: company.id, name: `Loc ${suffix}` }).returning();
  cleanup.unshift(() => db.delete(schema.locations).where(eq(schema.locations.id, loc.id)));
  b = await storage.getCompanyDeletionBlockers(company.id);
  assert.equal(b.locations, 1, `expected 1 blocking location, got ${b.locations}`);

  // 3) An employee whose home company is this one is counted.
  const empId = `delemp-${suffix}`;
  await db.insert(schema.users).values({
    id: empId, email: `${empId}@test.local`, firstName: "Del", lastName: "Emp",
    role: "employee", companyId: company.id,
  });
  cleanup.unshift(() => db.delete(schema.users).where(eq(schema.users.id, empId)));
  b = await storage.getCompanyDeletionBlockers(company.id);
  assert.equal(b.employees, 1, `expected 1 blocking employee, got ${b.employees}`);

  // 4) An employee *paid by* this company (payroll payee) is counted separately.
  await db.insert(schema.userEmploymentProfiles).values({
    userId: empId, payrollCompanyId: company.id,
  });
  cleanup.unshift(() => db.delete(schema.userEmploymentProfiles).where(eq(schema.userEmploymentProfiles.userId, empId)));
  b = await storage.getCompanyDeletionBlockers(company.id);
  assert.equal(b.payrollPayeeFor, 1, `expected 1 payroll-payee link, got ${b.payrollPayeeFor}`);

  // 5) The operational company is identifiable and distinct from our throwaway.
  const operational = await storage.getOperationalCompany();
  assert.ok(operational, "an operational company should resolve");
  assert.notEqual(operational!.id, company.id, "throwaway company must not be the operational one");

  console.log("OK — company deletion blockers count employees, payroll payees, and locations.");
} finally {
  for (const fn of cleanup) {
    try { await fn(); } catch {}
  }
}
process.exit(0);
