/**
 * getLedgerForEmployees must process the WHOLE roster even when it is larger
 * than the internal concurrency limit (bounded to protect the small DB pool).
 * Regression guard for the fix to "500: timeout exceeded when trying to
 * connect" when running a report across all employees: the bounded-concurrency
 * runner must still cover every employee, not just the first batch.
 *
 * Run with: `npx tsx server/__tests__/ledgerBulkConcurrency.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceLedger } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { getLedgerForEmployees, summarizeLedger } from "../attendanceLedger";

const stamp = `ledgerbulk-${Date.now().toString(36)}`;
const startDate = "2026-02-02"; // Monday
const endDate = "2026-02-02";
const now = new Date("2026-02-03T12:00:00Z");

// More employees than LEDGER_RECOMPUTE_CONCURRENCY (3), so the second+ batches
// must run too. Each works exactly 8h that day.
const N = 7;
const ids: string[] = [];

test("getLedgerForEmployees covers every employee past the concurrency limit", async (t) => {
  const reviewer = await storage.getUser("admin-dev-001");
  assert.ok(reviewer, "expected seeded admin-dev-001");

  for (let i = 0; i < N; i++) {
    const [u] = await db.insert(users).values({
      email: `${stamp}-${i}@example.invalid`,
      firstName: "Bulk",
      lastName: `${stamp}-${i}`,
      role: "employee",
      companyId: reviewer.companyId,
    }).returning();
    ids.push(u.id);
    await db.insert(punchLogs).values({
      employeeId: u.id,
      workDate: startDate,
      clockIn: new Date(`${startDate}T09:00:00Z`),
      clockOut: new Date(`${startDate}T17:00:00Z`),
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    });
  }

  t.after(async () => {
    await db.delete(attendanceLedger).where(inArray(attendanceLedger.employeeId, ids)).catch(() => {});
    await db.delete(punchLogs).where(inArray(punchLogs.employeeId, ids)).catch(() => {});
    await db.delete(users).where(inArray(users.id, ids)).catch(() => {});
  });

  const employees = [];
  for (const id of ids) {
    const u = await storage.getUser(id);
    assert.ok(u);
    employees.push(u);
  }

  const byEmp = await getLedgerForEmployees(employees, startDate, endDate, now);

  // Every employee is present (none dropped by the bounded runner)...
  assert.equal(byEmp.size, N, "all employees returned");
  for (const id of ids) {
    const days = byEmp.get(id);
    assert.ok(days, `employee ${id} present`);
    const totals = summarizeLedger(days!);
    assert.equal(totals.daysWorked, 1, `employee ${id} worked 1 day`);
    assert.equal(Math.round(totals.totalHours), 8, `employee ${id} has 8h`);
  }

  // ...and the recompute persisted a ledger row for each (write-through ran).
  const persisted = await db
    .select()
    .from(attendanceLedger)
    .where(inArray(attendanceLedger.employeeId, ids));
  const persistedEmps = new Set(persisted.map((r) => r.employeeId));
  assert.equal(persistedEmps.size, N, "ledger persisted for every employee");
});
