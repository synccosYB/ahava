/**
 * The payroll summary report (one line per employee, totals only) must roll up
 * to EXACTLY the same numbers as the detailed per-day rows — they share one
 * builder (server/services/payrollReport.ts). This verifies the per-employee
 * totals (amount, paid hours, bonus), the display fields (tax class, paying
 * company, payee, memo, department, pay type), and that multiple records on the
 * same day merge into one day.
 *
 * Run with: `npx tsx server/__tests__/payrollReportSummary.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  users, companies, departments, userEmploymentProfiles, payrollExports, payrollBatchRecords,
} from "@shared/schema";
import { buildPayrollReport } from "../services/payrollReport";

const stamp = `pr-${Date.now().toString(36)}`;
const RATE = 25;

test("summary totals equal the sum of the daily rows, with display fields and same-day merge", async (t) => {
  // --- fixture ---
  const [company] = await db.insert(companies).values({ name: `${stamp} Pay Co` }).returning();
  const [dept] = await db.insert(departments).values({ name: `${stamp} Dept`, companyId: company.id }).returning();
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Pat", lastName: stamp,
    role: "employee", companyId: company.id, departmentId: dept.id,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: "hourly", hourlyRate: RATE, taxClassification: "1099",
    payrollCompanyId: company.id, payeeName: "Payee LLC", payeeMemo: "memo text",
  });
  const [exp] = await db.insert(payrollExports).values({
    companyId: company.id, startDate: "2025-06-16", endDate: "2025-06-22", status: "draft",
  }).returning();

  const rec = (over: Record<string, unknown>) => ({
    payrollExportId: exp.id, employeeId: emp.id, recordType: "regular",
    overtimeMultiplier: 1.5, doubleTimeMultiplier: 2, hourlyRate: RATE, ...over,
  });
  // Day 1: 8h regular → $200
  await db.insert(payrollBatchRecords).values(rec({ workDate: "2025-06-16", regularHours: 8 }) as any);
  // Day 2: 8h regular + 2h OT → 200 + 2*25*1.5 = $275
  await db.insert(payrollBatchRecords).values(rec({ workDate: "2025-06-17", regularHours: 8, overtimeHours: 2 }) as any);
  // Day 2 again (same date): a $20 bonus record → merges into day 2
  await db.insert(payrollBatchRecords).values(rec({ workDate: "2025-06-17", regularHours: 0, bonusAmount: 20, bonusDescription: "Sunday bonus" }) as any);
  // Day 3: 8h PTO → 8*25 = $200
  await db.insert(payrollBatchRecords).values(rec({ workDate: "2025-06-18", recordType: "pto", ptoHours: 8 }) as any);

  t.after(async () => {
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.payrollExportId, exp.id)).catch(() => {});
    await db.delete(payrollExports).where(eq(payrollExports.id, exp.id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, emp.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, emp.id)).catch(() => {});
    await db.delete(departments).where(eq(departments.id, dept.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, company.id)).catch(() => {});
  });

  // --- act ---
  const report = await buildPayrollReport(exp.id, { includeSuperAdmin: true });
  assert.ok(report, "report builds");
  const me = report!.employees.find((e) => e.employeeId === emp.id);
  assert.ok(me, "the employee appears in the report");

  // --- totals (this is what the summary line shows) ---
  assert.equal(me!.totalAmount, 695, "amount = 200 + 275 + 20 (bonus) + 200 PTO");
  assert.equal(me!.totalPaidHours, 26, "paid hours = 8 + 10 + 8");
  assert.equal(me!.totalBonusAmount, 20, "bonus total");

  // --- the summary line equals the sum of the detailed day rows ---
  const dayAmount = me!.days.reduce((s, d) => s + d.amount, 0);
  const dayHours = me!.days.reduce((s, d) => s + d.paidHours, 0);
  assert.equal(Math.round(dayAmount * 100) / 100, me!.totalAmount, "detailed day amounts sum to the summary amount");
  assert.equal(Math.round(dayHours * 100) / 100, me!.totalPaidHours, "detailed day hours sum to the summary hours");

  // --- same-day merge: 4 records → 3 days ---
  assert.equal(me!.days.length, 3, "the two 06/17 records merged into one day");
  const day2 = me!.days.find((d) => d.sortDate === "2025-06-17")!;
  assert.equal(day2.amount, 295, "day 2 = 275 worked + 20 bonus");
  assert.equal(day2.bonusAmount, 20, "day 2 bonus folded in");

  // --- display fields for the summary columns ---
  assert.equal(me!.taxClassification, "1099");
  assert.equal(me!.payrollCompany, `${stamp} Pay Co`);
  assert.equal(me!.payee, "Payee LLC");
  assert.equal(me!.payeeMemo, "memo text");
  assert.equal(me!.department, `${stamp} Dept`);
  assert.equal(me!.payType, "Regular", "no schedule set → all days Regular");
});
