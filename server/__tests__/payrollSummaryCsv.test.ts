/**
 * formatSummaryCsv is the single formatter behind both the "Export · Report
 * (totals)" file and each per-payroll-company "Send to Payroll Company" report.
 * Pure (no DB): verifies the header (incl. the Pay Rate column), a data row,
 * the optional title line, and that partitioning employees into company buckets
 * yields independent CSVs — the mechanism the send endpoint relies on.
 *
 * Run: `npx tsx server/__tests__/payrollSummaryCsv.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummaryCsv, type PayrollReportEmployee } from "../services/payrollReport";

const emp = (over: Partial<PayrollReportEmployee>): PayrollReportEmployee => ({
  employeeId: "e1", employeeName: "Chaim Tester", taxClassification: "W-2",
  payrollCompany: "EZ", payee: "", payeeMemo: "", department: "Nursing",
  payType: "Regular", payRate: 23, days: [], totalAmount: 920, totalPaidHours: 40,
  totalBonusAmount: 0, ...over,
});

test("summary CSV: header has Pay Rate, rows render rate + amount, title optional", () => {
  const csv = formatSummaryCsv([emp({})], "2025-09-17 to 2025-09-30", "Payroll handoff — EZ (v1)");
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Payroll handoff — EZ (v1)", "title line first when provided");
  assert.equal(lines[1], "Pay Period: 2025-09-17 to 2025-09-30");
  assert.match(lines[2], /^Employee Name,Tax Classification,Payroll Company,Payee,Memo,Pay Rate,Amount,/);
  // Data row: rate "$23.00" then amount "$920.00".
  assert.match(lines[3], /"Chaim Tester".*"\$23\.00","\$920\.00"/);
});

test("summary CSV: no title line when omitted; zero rate renders blank", () => {
  const csv = formatSummaryCsv([emp({ payRate: 0 })], "p");
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Pay Period: p", "no title → period is first line");
  // Pay Rate cell empty (",,") between Memo and Amount when rate is 0.
  assert.match(lines[2], /"",,"\$920\.00"/);
});

test("per-company partition yields independent CSVs", () => {
  const ez = formatSummaryCsv([emp({ employeeName: "A", payrollCompany: "EZ" })], "p", "EZ");
  const pc = formatSummaryCsv([emp({ employeeName: "B", payrollCompany: "PC" })], "p", "PC");
  assert.ok(ez.includes('"A"') && !ez.includes('"B"'), "EZ report has only EZ employees");
  assert.ok(pc.includes('"B"') && !pc.includes('"A"'), "PC report has only PC employees");
});
