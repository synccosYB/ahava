/**
 * "Add to the already-sent report" route: when an admin folds an approved
 * back-pay delta into the SOURCE batch (instead of the next period), a labeled
 * back-pay record is added to that export. This verifies the money then shows
 * up when that batch's report is rebuilt — i.e. re-exporting includes the
 * change — via the same buildPayrollReport the Send-to-Payroll handoff uses.
 *
 * Run: `npx tsx server/__tests__/backpayAddToSent.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, companies, userEmploymentProfiles, payrollExports, payrollBatchRecords } from "@shared/schema";
import { buildPayrollReport } from "../services/payrollReport";

const stamp = `ats-${Date.now().toString(36)}`;
const RATE = 20;

test("folding a back-pay delta into the source batch shows up in its report", async (t) => {
  const [company] = await db.insert(companies).values({ name: `${stamp} Co` }).returning();
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Chaim", lastName: stamp, role: "employee", companyId: company.id,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: "hourly", hourlyRate: RATE, taxClassification: "W-2", payrollCompanyId: company.id,
  });
  const [exp] = await db.insert(payrollExports).values({
    companyId: company.id, startDate: "2025-09-17", endDate: "2025-09-30", status: "sent",
  }).returning();

  t.after(async () => {
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.payrollExportId, exp.id)).catch(() => {});
    await db.delete(payrollExports).where(eq(payrollExports.id, exp.id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, emp.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, emp.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, company.id)).catch(() => {});
  });

  // The batch originally paid one 8h day = $160.
  await db.insert(payrollBatchRecords).values({
    payrollExportId: exp.id, employeeId: emp.id, recordType: "regular", workDate: "2025-09-18",
    regularHours: 8, hourlyRate: RATE, overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
  } as any);

  const before = await buildPayrollReport(exp.id, { includeSuperAdmin: true });
  const meBefore = before!.employees.find((e) => e.employeeId === emp.id)!;
  assert.equal(meBefore.totalAmount, 160, "source batch originally pays $160");

  // Fold in an approved back-pay delta of 2 reg hours (what the add_to_sent route does).
  await db.insert(payrollBatchRecords).values({
    payrollExportId: exp.id, employeeId: emp.id, recordType: "backpay", workDate: "2025-09-20",
    regularHours: 2, hourlyRate: RATE, overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
    issueDescription: "Back-pay: fixed missing punch",
  } as any);

  const after = await buildPayrollReport(exp.id, { includeSuperAdmin: true });
  const meAfter = after!.employees.find((e) => e.employeeId === emp.id)!;
  assert.equal(meAfter.totalAmount, 200, "re-export now includes the folded-in $40 back-pay");
  assert.equal(meAfter.days.length, 2, "the back-pay appears as its own day line");
});
