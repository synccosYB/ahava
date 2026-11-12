/**
 * "Send to Payroll" confirmations: a day is confirmed (and therefore paid) at
 * most once per employee. addPayrollSubmissions is idempotent against the unique
 * (employee_id, work_date) index, and listPayrollSubmissions is range-scoped.
 *
 * Run with: `npx tsx server/__tests__/payrollSubmissions.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, payrollSubmissions, payrollExports } from "@shared/schema";

const stamp = `paysub-${Date.now().toString(36)}`;
let employeeId = "";
const exportIds: string[] = [];

async function cleanup() {
  await db.delete(payrollSubmissions).where(eq(payrollSubmissions.employeeId, employeeId)).catch(() => {});
  if (exportIds.length) await db.delete(payrollExports).where(inArray(payrollExports.id, exportIds)).catch(() => {});
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

test("ready-for-payroll: confirmed days list unbatched until a batch claims them", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-rfp@example.invalid`, firstName: "Ready", lastName: `${stamp}rfp`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  employeeId = emp.id;
  t.after(cleanup);

  await storage.addPayrollSubmissions([
    { employeeId, workDate: "2026-10-29", sentBy: admin?.id ?? null },
    { employeeId, workDate: "2026-10-30", sentBy: admin?.id ?? null },
    { employeeId, workDate: "2026-11-02", sentBy: admin?.id ?? null },
  ]);

  // All three are "ready" (unbatched) within the period; a later period is empty.
  const ready = (await storage.listUnbatchedPayrollSubmissions("2026-10-29", "2026-11-11"))
    .filter((r) => r.employeeId === employeeId);
  assert.equal(ready.length, 3, "all confirmed days are ready before batching");
  const laterPeriod = (await storage.listUnbatchedPayrollSubmissions("2026-11-12", "2026-11-25"))
    .filter((r) => r.employeeId === employeeId);
  assert.equal(laterPeriod.length, 0, "ready list is range-scoped");

  // A batch claims two of the days; those drop out of the ready list, the third stays.
  const [exp] = await db.insert(payrollExports).values({
    startDate: "2026-10-29", endDate: "2026-11-11", status: "draft", createdBy: admin?.id ?? null,
  }).returning();
  exportIds.push(exp.id);
  const claimIds = ready.filter((r) => r.workDate !== "2026-11-02").map((r) => r.id);
  const linked = await storage.markPayrollSubmissionsBatched(claimIds, exp.id);
  assert.equal(linked, 2, "two days were linked to the batch");

  const stillReady = (await storage.listUnbatchedPayrollSubmissions("2026-10-29", "2026-11-11"))
    .filter((r) => r.employeeId === employeeId);
  assert.deepEqual(stillReady.map((r) => r.workDate), ["2026-11-02"], "batched days leave the ready list");

  // Re-claiming is idempotent: already-batched rows are guarded (payroll_export_id
  // IS NULL), so no day is ever pulled into a second batch / paid twice.
  const reLinked = await storage.markPayrollSubmissionsBatched(claimIds, exp.id);
  assert.equal(reLinked, 0, "already-batched days are not re-linked");
});
