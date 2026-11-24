/**
 * Back-pay bridge: when an approver fills/edits a punch on a day that was already
 * paid in a finalized export, the pay DIFFERENCE must be queued as a PENDING
 * back-pay item for the next payroll — the finalized batch is never touched.
 *
 * This exercises the routing core (routeBackpayForCorrection) that the punch-edit
 * endpoint calls when `routeBackpay` is set: a day the export paid 0 hours (a
 * missing clock-out), now completed to 8h, must produce an ~8h pending item.
 *
 * Run with: `npx tsx server/__tests__/backpayBridge.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  users, companies, userEmploymentProfiles, punchLogs, payrollExports, payrollBatchRecords, payrollBackpayItems,
} from "@shared/schema";
import { routeBackpayForCorrection } from "../services/backpayRouting";

const stamp = `bpb-${Date.now().toString(36)}`;
const WORK_DATE = "2025-06-16";
const RATE = 25;

test("filling a missing clock-out on an already-paid day queues the delta as pending back-pay", async (t) => {
  const [company] = await db.insert(companies).values({ name: `${stamp} Co` }).returning();
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Chaim", lastName: stamp,
    role: "employee", companyId: company.id,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: "hourly", hourlyRate: RATE, overtimeEligible: true,
  });

  // A finalized export that PAID 0 hours for this day (the missing clock-out).
  const [exp] = await db.insert(payrollExports).values({
    companyId: company.id, startDate: WORK_DATE, endDate: "2025-06-22", status: "exported",
  }).returning();
  await db.insert(payrollBatchRecords).values({
    payrollExportId: exp.id, employeeId: emp.id, recordType: "attendance", workDate: WORK_DATE,
    regularHours: 0, overtimeHours: 0, doubleTimeHours: 0,
    // Frozen policy snapshot so the week recomputes identically.
    otThresholdDaily: 8, overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
    overtimeEnabled: true, hourlyRate: RATE, workweekStartDay: 0,
  } as any);

  // The clock-out has now been filled → the day is a complete 8h shift.
  await storage.createPunchLog({
    employeeId: emp.id, workDate: WORK_DATE,
    clockIn: new Date(`${WORK_DATE}T09:00:00Z`), clockOut: new Date(`${WORK_DATE}T17:00:00Z`),
    hoursWorked: 8, status: "completed", source: "manager", approved: true,
  });

  t.after(async () => {
    await db.delete(payrollBackpayItems).where(eq(payrollBackpayItems.employeeId, emp.id)).catch(() => {});
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.payrollExportId, exp.id)).catch(() => {});
    await db.delete(payrollExports).where(eq(payrollExports.id, exp.id)).catch(() => {});
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, emp.id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, emp.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, emp.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, company.id)).catch(() => {});
  });

  const created = await routeBackpayForCorrection({
    employee: emp as any,
    workDate: WORK_DATE,
    sourceExports: [exp as any],
    attendanceExceptionId: null,
    punchLogId: null,
    requestedBy: emp.id,
    reasonPrefix: "test",
  });

  assert.equal(created.length, 1, "one pending back-pay item is created");
  const item = created[0];
  assert.equal(item.status, "pending", "it is pending admin approval, not auto-paid");
  assert.equal(item.sourcePayrollExportId, exp.id, "linked to the source (already-paid) export");
  assert.equal(Math.round((item.regularHours ?? 0) * 100) / 100, 8, "delta = 8h (paid 0 → corrected 8)");
  assert.equal(Math.round((item.overtimeHours ?? 0) * 100) / 100, 0, "no overtime (8h = daily threshold)");
  assert.equal(item.hourlyRate, RATE, "rate carried from the frozen snapshot");
});
