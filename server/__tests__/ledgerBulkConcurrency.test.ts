/**
 * Bulk attendance reads cover the entire scoped roster, preserve single-read
 * results, and use a fixed input-query budget. Changed and deleted days still
 * write through to the canonical ledger.
 * Requires a migrated + seeded DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "../db";
import { storage } from "../storage";
import { users, punchLogs, attendanceLedger } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { getLedgerForEmployees, getLedgerForEmployee, summarizeLedger } from "../attendanceLedger";

const stamp = `ledgerbulk-${Date.now().toString(36)}`;
const startDate = "2026-02-02"; // Monday
const endDate = "2026-02-02";
const now = new Date("2026-02-03T12:00:00Z");

// A roster large enough to catch per-employee queries. Each works 8h that day.
const N = 25;
const ids: string[] = [];

test("bulk ledger preserves the roster with constant input queries", async (t) => {
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

  // Every scoped employee is present.
  assert.equal(byEmp.size, N, "all employees returned");
  for (const id of ids) {
    const days = byEmp.get(id);
    assert.ok(days, `employee ${id} present`);
    const totals = summarizeLedger(days!);
    assert.equal(totals.daysWorked, 1, `employee ${id} worked 1 day`);
    assert.equal(Math.round(totals.totalHours), 8, `employee ${id} has 8h`);
  }

  // A warm bulk read must use a constant number of queries, not N policy,
  // profile, schedule or persisted-ledger reads. Count the real driver calls.
  let queries = 0;
  const originalQuery = pool.query;
  pool.query = function (...args: any[]) {
    queries++;
    return (originalQuery as any).apply(this, args);
  } as typeof pool.query;
  try {
    const singleStart = performance.now();
    for (const employee of employees) {
      assert.deepEqual(await getLedgerForEmployee(employee, startDate, endDate, now), byEmp.get(employee.id));
    }
    const singleQueries = queries;
    const singleMs = performance.now() - singleStart;
    queries = 0;
    const bulkStart = performance.now();
    const warm = await getLedgerForEmployees(employees, startDate, endDate, now);
    assert.deepEqual(warm, byEmp, "warm calculation preserves every employee-day");
    console.log(`Roster ${N}: individual reads ${singleQueries} queries / ${singleMs.toFixed(1)}ms; bulk ${queries} queries / ${(performance.now() - bulkStart).toFixed(1)}ms`);
    assert.ok(singleQueries > queries * N, "bulk removes per-employee database work");
    assert.equal(queries, 9, "bulk input reads are fixed at 9, independent of roster size; no unchanged writes");
  } finally {
    pool.query = originalQuery;
  }

  // ...and the recompute persisted a ledger row for each (write-through ran).
  const persisted = await db
    .select()
    .from(attendanceLedger)
    .where(inArray(attendanceLedger.employeeId, ids));
  const persistedEmps = new Set(persisted.map((r) => r.employeeId));
  assert.equal(persistedEmps.size, N, "ledger persisted for every employee");
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, ids[0]));
  const afterDelete = await getLedgerForEmployees(employees, startDate, endDate, now);
  assert.deepEqual(afterDelete.get(ids[0]), [], "deleted facts remove the computed day");
  const remaining = await db.select().from(attendanceLedger).where(inArray(attendanceLedger.employeeId, ids));
  assert.equal(remaining.length, N - 1, "bulk deletes the stale persisted day");
  assert.ok(remaining.every(row => row.employeeId !== ids[0]), "other employees remain intact");
});
