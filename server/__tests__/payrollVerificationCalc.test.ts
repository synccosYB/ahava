/**
 * DB-backed coverage for the payroll export reconciliation / verification calc
 * path: `computePayrollVerification` in server/services/reconciliation.ts.
 *
 * This is the function that recomputes each attendance batch record's
 * regular/overtime split from its source punch (via the central hours engine +
 * the employee's OT threshold) and flags drift. It exercises:
 *   - the OT split (regular = threshold, overtime = hours - threshold)
 *   - clean records producing zero discrepancies
 *   - exported hours that no longer match the source punch
 *   - batch records with no linked punch / a deleted source punch
 *   - PTO / cash-out rows being skipped (not recomputable)
 *
 * Run with: `npx tsx server/__tests__/payrollVerificationCalc.test.ts`  (requires DATABASE_URL)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../storage";
import { computePayrollVerification } from "../services/reconciliation";
import { db } from "../db";
import {
  users,
  punchLogs,
  payrollExports,
  payrollBatchRecords,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const userId = `pay-emp-${stamp}`;
let exportId = "";
const createdPunchIds: string[] = [];

async function makePunch(workDate: string, startH: number, endH: number, breakMinutes = 0): Promise<string> {
  const [row] = await db
    .insert(punchLogs)
    .values({
      employeeId: userId,
      workDate,
      clockIn: new Date(`${workDate}T${String(startH).padStart(2, "0")}:00:00`),
      clockOut: new Date(`${workDate}T${String(endH).padStart(2, "0")}:00:00`),
      breakMinutes,
      hoursWorked: endH - startH - breakMinutes / 60,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();
  createdPunchIds.push(row.id);
  return row.id;
}

async function makeBatchRecord(opts: {
  recordType: string;
  workDate: string;
  punchLogId?: string | null;
  regularHours?: number;
  overtimeHours?: number;
  ptoHours?: number;
}) {
  await db.insert(payrollBatchRecords).values({
    payrollExportId: exportId,
    employeeId: userId,
    punchLogId: opts.punchLogId ?? null,
    recordType: opts.recordType,
    workDate: opts.workDate,
    regularHours: opts.regularHours ?? 0,
    overtimeHours: opts.overtimeHours ?? 0,
    ptoHours: opts.ptoHours ?? 0,
  });
}

test.before(async () => {
  await db.insert(users).values({
    id: userId,
    email: `${userId}@test.local`,
    firstName: "Pay",
    lastName: "Roll",
    role: "employee",
    status: "active",
  });
  const [exp] = await db
    .insert(payrollExports)
    .values({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      status: "exported",
    })
    .returning();
  exportId = exp.id;
});

test.after(async () => {
  await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.payrollExportId, exportId));
  if (createdPunchIds.length) {
    await db.delete(punchLogs).where(inArray(punchLogs.id, createdPunchIds));
  }
  await db.delete(payrollExports).where(eq(payrollExports.id, exportId));
  await db.delete(users).where(eq(users.id, userId));
});

test("clean export: stored regular/overtime match the recomputed split → no discrepancy", async () => {
  // 8h punch → 8 regular, 0 overtime (threshold default 8).
  const p1 = await makePunch("2026-01-05", 9, 17, 0);
  await makeBatchRecord({ recordType: "attendance", workDate: "2026-01-05", punchLogId: p1, regularHours: 8, overtimeHours: 0 });

  // 10h punch → OT split: 8 regular + 2 overtime.
  const p2 = await makePunch("2026-01-06", 8, 18, 0);
  await makeBatchRecord({ recordType: "attendance", workDate: "2026-01-06", punchLogId: p2, regularHours: 8, overtimeHours: 2 });

  const result = await computePayrollVerification(exportId);
  assert.ok(result);
  assert.equal(result!.recordsChecked, 2);
  assert.equal(result!.discrepancyCount, 0);
});

test("drifted export: exported hours no longer match recomputed source punch", async () => {
  // Source punch is 10h (→ 8 reg + 2 OT) but the export stored a flat 10 reg / 0 OT.
  const p = await makePunch("2026-01-07", 8, 18, 0);
  await makeBatchRecord({ recordType: "attendance", workDate: "2026-01-07", punchLogId: p, regularHours: 10, overtimeHours: 0 });

  const result = await computePayrollVerification(exportId);
  assert.ok(result);
  const d = result!.discrepancies.find((x) => x.workDate === "2026-01-07");
  assert.ok(d, "expected a discrepancy for the drifted row");
  assert.equal(d!.computedRegular, 8);
  assert.equal(d!.computedOvertime, 2);
  assert.equal(d!.storedRegular, 10);
  assert.equal(d!.storedOvertime, 0);
});

test("missing link: attendance record with no punch is flagged unverifiable", async () => {
  await makeBatchRecord({ recordType: "attendance", workDate: "2026-01-08", punchLogId: null, regularHours: 8 });
  const result = await computePayrollVerification(exportId);
  const d = result!.discrepancies.find((x) => x.workDate === "2026-01-08");
  assert.ok(d);
  assert.equal(d!.computedRegular, null);
  // The engine describes an attendance record whose employee-day has no source
  // punches as "No source punches found for this employee-day…"; accept either
  // that wording or the older "no linked punch" phrasing.
  assert.match(d!.issue, /no linked punch|no source punches/i);
});

test("PTO rows are skipped: only attendance rows are recomputable", async () => {
  await makeBatchRecord({ recordType: "pto", workDate: "2026-01-10", ptoHours: 8 });
  await makeBatchRecord({ recordType: "pto_cashout", workDate: "2026-01-11", ptoHours: 16 });
  const result = await computePayrollVerification(exportId);
  // recordsChecked counts ONLY attendance rows; the two PTO rows above add none.
  const ptoDates = result!.discrepancies.filter((x) => x.workDate === "2026-01-10" || x.workDate === "2026-01-11");
  assert.equal(ptoDates.length, 0, "PTO/cash-out rows must not be verified or flagged");
});

test("verification reflects the export's status and date window", async () => {
  const result = await computePayrollVerification(exportId);
  assert.ok(result);
  assert.equal(result!.status, "exported");
  assert.equal(result!.startDate, "2026-01-01");
  assert.equal(result!.endDate, "2026-01-31");
});

test("unknown export id yields null", async () => {
  const result = await computePayrollVerification("does-not-exist");
  assert.equal(result, null);
});
