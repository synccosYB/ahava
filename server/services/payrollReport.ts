/**
 * Shared payroll-report builder.
 *
 * Produces, for one payroll export (batch), the per-employee structure used by
 * BOTH the detailed CSV (a line per worked day + a per-employee totals line) and
 * the summary report (one line per employee, totals only). Centralizing the math
 * here guarantees the summary totals are identical to the detailed export's
 * "Paid Totals" row — they are the same numbers, computed once.
 *
 * All dollar/hours math mirrors the frozen snapshot on each batch record (hourly
 * rate, OT/DT multipliers), falling back to the live employment profile only for
 * legacy rows that predate the snapshot, so historical reports never drift.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { attendanceExceptions } from "@shared/schema";
import { computeGrossPay, round2 } from "../payrollEngine";
import { DEFAULT_PAYROLL_RULES } from "../policyEngine";

// Kept in sync with routes.ts: the seeded super-admin is hidden from ordinary
// admins' payroll reports.
const SUPER_ADMIN_USER_ID = "admin-dev-001";

// One worked day for one employee (several same-day records are merged).
export type PayrollReportDay = {
  employeeName: string;
  taxClassification: string;
  payrollCompany: string;
  payee: string;
  payeeMemo: string;
  amount: number;
  payType: string;
  department: string;
  paidHours: number;
  payRate: number;      // frozen hourly rate used to pay this day (0 when unknown)
  dateWorked: string;   // "Mon, 11/02/2026"
  sortDate: string;     // "2026-11-02"
  wasCorrected: boolean;
  bonusAmount: number;
  bonusDescriptions: string[];
};

// One employee's full slice of the batch: the daily rows plus the rolled-up
// totals. The display fields (tax class, paying company, payee, memo, dept) are
// employee-level; payType is summarized across the days present.
export type PayrollReportEmployee = {
  employeeId: string;
  employeeName: string;
  taxClassification: string;
  payrollCompany: string;
  payee: string;
  payeeMemo: string;
  department: string;
  payType: string;
  payRate: number;      // employee's hourly pay rate (0 when unknown / not hourly)
  days: PayrollReportDay[];
  totalAmount: number;
  totalPaidHours: number;
  totalBonusAmount: number;
};

function formatDateWorked(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[dt.getUTCDay()]}, ${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((p) => parseInt(p, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Build the per-employee report for a payroll export. Pure read — no writes.
 * Returns the employees in a stable order (by name) with their daily rows and
 * totals. Throws nothing batch-specific: callers handle a missing export.
 */
export async function buildPayrollReport(
  exportId: string,
  opts: { includeSuperAdmin: boolean },
): Promise<{ employees: PayrollReportEmployee[] } | null> {
  const exp = await storage.getPayrollExport(exportId);
  if (!exp) return null;

  const records = await storage.getPayrollBatchRecords(exportId);
  const allUsersRaw = await storage.getAllUsers();
  const allUsers = opts.includeSuperAdmin
    ? allUsersRaw
    : allUsersRaw.filter((u) => u.id !== SUPER_ADMIN_USER_ID);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const allDepartments = await storage.getAllDepartments();
  const deptMap = new Map(allDepartments.map((d) => [d.id, d.name]));

  const profileCache = new Map<string, Awaited<ReturnType<typeof storage.getEmploymentProfile>> | null>();
  const scheduleCache = new Map<string, Awaited<ReturnType<typeof storage.getEmployeeSchedules>>>();
  const companyNameCache = new Map<string, string | null>();

  const getProfile = async (userId: string) => {
    if (!profileCache.has(userId)) profileCache.set(userId, (await storage.getEmploymentProfile(userId)) || null);
    return profileCache.get(userId);
  };
  const getSchedules = async (userId: string) => {
    if (!scheduleCache.has(userId)) scheduleCache.set(userId, await storage.getEmployeeSchedules(userId));
    return scheduleCache.get(userId)!;
  };
  const resolveCompanyName = async (companyId: string | null | undefined): Promise<string | null> => {
    if (!companyId) return null;
    if (!companyNameCache.has(companyId)) {
      const c = await storage.getCompany(companyId);
      companyNameCache.set(companyId, c?.name ?? null);
    }
    return companyNameCache.get(companyId)!;
  };
  const getPayrollCompanyName = async (
    r: typeof records[number],
    profile: Awaited<ReturnType<typeof getProfile>>,
  ): Promise<string> => {
    if (r.payrollCompanyName) return r.payrollCompanyName;
    const fromSnapshotId = await resolveCompanyName(r.payrollCompanyId);
    if (fromSnapshotId) return fromSnapshotId;
    const fromProfile = await resolveCompanyName(profile?.payrollCompanyId);
    return fromProfile ?? "";
  };

  // Which punches in this batch were created/updated via an approved correction.
  const approvedExceptions = await db
    .select({ punchLogId: attendanceExceptions.punchLogId })
    .from(attendanceExceptions)
    .where(and(eq(attendanceExceptions.status, "approved"), isNotNull(attendanceExceptions.punchLogId)));
  const correctedPunchLogIds = new Set(
    approvedExceptions.map((e) => e.punchLogId).filter(Boolean) as string[],
  );

  const employeeDays = new Map<string, Map<string, PayrollReportDay>>();

  for (const r of records) {
    const user = userMap.get(r.employeeId);
    const employeeName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown";
    const department = user?.departmentId ? (deptMap.get(user.departmentId) || "") : "";
    const profile = await getProfile(r.employeeId);
    const schedules = await getSchedules(r.employeeId);
    const payrollCompany = await getPayrollCompanyName(r, profile);

    // Prefer the rate frozen on the record; fall back to the live profile for
    // legacy rows so historical exports never drift.
    let hourlyRate = r.hourlyRate ?? 0;
    if (r.hourlyRate == null && profile) {
      if (profile.hourlyRate) hourlyRate = profile.hourlyRate;
      else if (profile.dailySalary) hourlyRate = profile.dailySalary / 8;
      else if (profile.weeklySalary) hourlyRate = profile.weeklySalary / 40;
    }

    const bonusAmount = r.bonusAmount || 0;
    const regHours = r.regularHours || 0;
    const otHours = r.overtimeHours || 0;
    const dtHours = r.doubleTimeHours || 0;
    const ptoHours = r.ptoHours || 0;
    const bonusHours = r.bonusHours || 0;
    // Paid hours take OT/DT/PTO/bonus hours at face value; the dollar amount
    // applies the (snapshotted) OT/DT premium multipliers.
    const totalHours = regHours + otHours + dtHours + ptoHours + bonusHours;
    const otMult = r.overtimeMultiplier ?? DEFAULT_PAYROLL_RULES.overtimeMultiplier;
    const dtMult = r.doubleTimeMultiplier ?? DEFAULT_PAYROLL_RULES.doubleTimeMultiplier;
    const workedPay = computeGrossPay(
      { regularHours: regHours, overtimeHours: otHours, doubleTimeHours: dtHours },
      hourlyRate,
      { overtimeMultiplier: otMult, doubleTimeMultiplier: dtMult },
    );
    const amount = round2(workedPay + ptoHours * hourlyRate + bonusAmount);

    const jsDayOfWeek = getDayOfWeek(r.workDate);
    const scheduledDays = schedules.filter((s) => s.isActive).map((s) => s.dayOfWeek);
    let payType = "Regular";
    if (r.recordType === "pto_cashout") payType = "PTO Cash-Out";
    else if (r.recordType === "pto") payType = "Regular";
    else if (profile?.payType === "contractual") payType = "Contractual";
    else if (scheduledDays.length > 0 && !scheduledDays.includes(jsDayOfWeek)) payType = "Holiday";

    const recCorrected = !!(r.punchLogId && correctedPunchLogIds.has(r.punchLogId));
    const trimmedBonusDesc = (r.bonusDescription || "").trim();

    if (!employeeDays.has(r.employeeId)) employeeDays.set(r.employeeId, new Map());
    const empDays = employeeDays.get(r.employeeId)!;
    const existing = empDays.get(r.workDate);
    if (existing) {
      existing.amount += amount;
      existing.paidHours += totalHours;
      existing.bonusAmount += bonusAmount;
      if (trimmedBonusDesc) existing.bonusDescriptions.push(trimmedBonusDesc);
      if (payType === "Holiday") existing.payType = "Holiday";
      if (recCorrected) existing.wasCorrected = true;
    } else {
      empDays.set(r.workDate, {
        employeeName,
        taxClassification: profile?.taxClassification || "W-2",
        payrollCompany,
        payee: profile?.payeeName || "",
        payeeMemo: profile?.payeeMemo || "",
        amount,
        payType,
        department,
        paidHours: totalHours,
        payRate: hourlyRate,
        dateWorked: formatDateWorked(r.workDate),
        sortDate: r.workDate,
        wasCorrected: recCorrected,
        bonusAmount,
        bonusDescriptions: trimmedBonusDesc ? [trimmedBonusDesc] : [],
      });
    }
  }

  const employees: PayrollReportEmployee[] = [];
  for (const [employeeId, dayMap] of employeeDays) {
    const days = Array.from(dayMap.values()).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    if (days.length === 0) continue;
    const totalAmount = round2(days.reduce((s, d) => s + d.amount, 0));
    const totalPaidHours = days.reduce((s, d) => s + d.paidHours, 0);
    const totalBonusAmount = round2(days.reduce((s, d) => s + d.bonusAmount, 0));
    // Summary-level pay type: the distinct day types present (usually just one).
    const distinctTypes = Array.from(new Set(days.map((d) => d.payType)));
    const first = days[0];
    employees.push({
      employeeId,
      employeeName: first.employeeName,
      taxClassification: first.taxClassification,
      payrollCompany: first.payrollCompany,
      payee: first.payee,
      payeeMemo: first.payeeMemo,
      department: first.department,
      payType: distinctTypes.join(" / "),
      // Employee-level rate: the highest rate seen across the days (most
      // employees have one rate; if a rate changed mid-period the higher one is
      // shown so the summary never understates the pay rate).
      payRate: days.reduce((mx, d) => Math.max(mx, d.payRate), 0),
      days,
      totalAmount,
      totalPaidHours,
      totalBonusAmount,
    });
  }
  employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return { employees };
}
