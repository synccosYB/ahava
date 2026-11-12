/**
 * "Send to Payroll" confirmations: a day is confirmed (and therefore paid) at
 * most once per employee. addPayrollSubmissions is idempotent against the unique
 * (employee_id, work_date) index, and listPayrollSubmissions is range-scoped.
 *
 * Run with: `npx tsx server/__tests__/payrollSubmissions.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, payrollSubmissions } from "@shared/schema";

const stamp = `paysub-${Date.now().toString(36)}`;
let employeeId = "";

async function cleanup() {
  await db.delete(payrollSubmissions).where(eq(payrollSubmissions.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
}

test("a day is sent at most once; re-sending is a no-op; list is range-scoped", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Pay", lastName: stamp,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  // Send three complete days.
  const first = await storage.addPayrollSubmissions([
    { employeeId, workDate: "2026-10-29", sentBy: admin?.id ?? null },
    { employeeId, workDate: "2026-10-30", sentBy: admin?.id ?? null },
    { employeeId, workDate: "2026-11-02", sentBy: admin?.id ?? null },
  ]);
  assert.equal(first, 3, "three new days recorded");

  // Re-send an overlapping set: only the genuinely-new day is added, the rest
  // are skipped (no double-pay).
  const second = await storage.addPayrollSubmissions([
    { employeeId, workDate: "2026-10-30", sentBy: admin?.id ?? null }, // already sent
    { employeeId, workDate: "2026-11-02", sentBy: admin?.id ?? null }, // already sent
    { employeeId, workDate: "2026-11-03", sentBy: admin?.id ?? null }, // new
  ]);
  assert.equal(second, 1, "only the one new day is added");

  // The period Oct 29 – Nov 11 contains all four; a narrower range excludes some.
  const inPeriod = await storage.listPayrollSubmissions(employeeId, "2026-10-29", "2026-11-11");
  assert.equal(inPeriod.length, 4);
  const narrow = await storage.listPayrollSubmissions(employeeId, "2026-11-01", "2026-11-11");
  assert.deepEqual(narrow.map((r) => r.workDate).sort(), ["2026-11-02", "2026-11-03"]);
});
