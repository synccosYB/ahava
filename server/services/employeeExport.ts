/**
 * Employee spreadsheet EXPORT (the round-trip partner of employeeImport.ts).
 *
 * Produces an .xlsx workbook with ONE TAB PER LOCATION (employees with no
 * location go on an "Unassigned" tab), every column the owner asked for, and
 * real dropdowns (Excel data validation, which Google Sheets preserves on
 * upload). Short lists are embedded inline per cell; a long list (Department)
 * is referenced from a VISIBLE "Lists" sheet (Google drops range dropdowns whose
 * source sheet is hidden). A hidden "Employee ID" column carries the stable user
 * id so a re-import matches each row to the exact person even if their name or
 * Clock # changed.
 *
 * Built with exceljs (not SheetJS) because the community SheetJS build cannot
 * WRITE data validations; the import side keeps using SheetJS to parse.
 *
 * This only READS data; it never mutates. The payroll-processing company column
 * is a dropdown placeholder (that field does not exist in the data model yet),
 * so it round-trips as display-only until the company-model change ships.
 */
import ExcelJS from "exceljs";
import { storage } from "../storage";
import { db } from "../db";
import { policyAssignments, policies as policiesTable } from "../../shared/schema";
import { eq, isNotNull } from "drizzle-orm";

// Dropdown option lists. Company lists are the owner's fixed vocabulary (the
// data model does not yet separate working / paying / payroll-processing, so
// these are the agreed labels the sheet offers regardless of what's stored).
export const WORKING_COMPANY_OPTIONS = ["Ahava Medical Center", "Tiferes Mordechai"];
export const PAYING_COMPANY_OPTIONS = ["Ahava Medical Center", "BCM", "Hirschfeld Oncology", "Ohel Chai"];
export const PAYROLL_COMPANY_OPTIONS = ["EZ Payroll", "PC Payroll", "Hirschfeld Oncology", "Inhouse"];
export const ROLE_OPTIONS = ["Employee", "Manager", "Admin"];
export const TAX_OPTIONS = ["W-2", "1099", "Volunteer"];
export const PAY_SETUP_OPTIONS = ["Hourly", "Daily", "Salary"];
export const LUNCH_OPTIONS = ["Required", "Not required"];

// Column layout. `key` is the exceljs column key; `header` is what the importer
// reads back (keep these header strings stable — the importer matches on them).
type ColId =
  | "employeeId" | "clockNumber" | "lastName" | "firstName" | "role" | "accessLevel"
  | "department" | "location" | "workingCompany" | "payingCompany" | "payrollCompany"
  | "tax" | "paySetup" | "payAmount" | "policies" | "lunch" | "termination";

const COLUMNS: { id: ColId; header: string; width: number; hidden?: boolean }[] = [
  { id: "employeeId", header: "Employee ID", width: 20, hidden: true },
  { id: "clockNumber", header: "Clock #", width: 10 },
  { id: "lastName", header: "Last Name", width: 18 },
  { id: "firstName", header: "First Name", width: 18 },
  { id: "role", header: "Role", width: 12 },
  { id: "accessLevel", header: "Access Level", width: 18 },
  { id: "department", header: "Department", width: 20 },
  { id: "location", header: "Location", width: 20 },
  { id: "workingCompany", header: "Working Company", width: 22 },
  { id: "payingCompany", header: "Paying Company", width: 20 },
  { id: "payrollCompany", header: "Payroll Company", width: 20 },
  { id: "tax", header: "Tax Classification", width: 16 },
  { id: "paySetup", header: "Pay Setup", width: 12 },
  { id: "payAmount", header: "Pay Amount", width: 12 },
  { id: "policies", header: "Policies", width: 30 },
  { id: "lunch", header: "Lunch Break", width: 14 },
  { id: "termination", header: "Termination Date", width: 16 },
];

type Row = Record<ColId, string | number | null>;

function titleCaseRole(r: string | null | undefined): string {
  if (!r) return "Employee";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function payAmountFor(profile: { payType?: string | null; hourlyRate?: number | null; dailySalary?: number | null; weeklySalary?: number | null } | undefined): number | null {
  if (!profile) return null;
  switch (profile.payType) {
    case "daily": return profile.dailySalary ?? null;
    case "salary": return profile.weeklySalary ?? null;
    case "hourly":
    default: return profile.hourlyRate ?? null;
  }
}

function paySetupLabel(payType: string | null | undefined): string {
  switch (payType) {
    case "daily": return "Daily";
    case "salary": return "Salary";
    case "hourly": return "Hourly";
    default: return payType ? payType.charAt(0).toUpperCase() + payType.slice(1) : "Hourly";
  }
}

// Excel sheet names: max 31 chars and none of : \ / ? * [ ]. Keep them unique.
function safeSheetName(name: string, used: Set<string>): string {
  let base = (name || "Unassigned").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Sheet";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)} ${n++}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Build the employee export workbook and return it as a Buffer (.xlsx).
 */
export async function buildEmployeeExport(): Promise<Buffer> {
  // The super-admin service account (hidden everywhere else in the UI) is kept
  // off the export too.
  const SUPER_ADMIN_USER_ID = "admin-dev-001";
  const allUsers = await storage.getAllUsers();
  const employees = allUsers.filter((u) => u.id !== SUPER_ADMIN_USER_ID);

  const [departments, companies, roles] = await Promise.all([
    storage.getAllDepartments(),
    storage.getAllCompanies(),
    storage.getAllRoles(),
  ]);
  const deptById = new Map(departments.map((d) => [d.id, d.name]));
  const companyById = new Map(companies.map((c) => [c.id, c.name]));
  const locationsAll = await storage.getAllLocations();
  const locById = new Map(locationsAll.map((l) => [l.id, l.name]));

  // Policy assignments grouped by user (one query, no N+1).
  const policyRows = await db
    .select({ userId: policyAssignments.userId, name: policiesTable.name })
    .from(policyAssignments)
    .innerJoin(policiesTable, eq(policiesTable.id, policyAssignments.policyId))
    .where(isNotNull(policyAssignments.userId));
  const policiesByUser = new Map<string, string[]>();
  for (const r of policyRows) {
    if (!r.userId) continue;
    const arr = policiesByUser.get(r.userId) ?? [];
    arr.push(r.name);
    policiesByUser.set(r.userId, arr);
  }

  // Build a row per employee, resolving their per-user memberships.
  type BuiltRow = { row: Row; locationName: string };
  const built: BuiltRow[] = [];
  for (const u of employees) {
    const [deptIds, locIds, userRoles, profile] = await Promise.all([
      storage.getUserDepartmentIds(u.id),
      storage.getUserLocationIds(u.id),
      storage.getUserRoles(u.id),
      storage.getEmploymentProfile(u.id),
    ]);
    const primaryLocationId = locIds.find((id) => id === u.locationId) ?? locIds[0];
    const locationName = locById.get(primaryLocationId) ?? "";
    const departmentName = deptIds.map((id) => deptById.get(id)).filter(Boolean).join(", ");
    // Access level = the first assigned non-system custom role, if any.
    const accessLevel = userRoles.map((r) => r.role?.name).filter(Boolean).join(", ");
    const row: Row = {
      employeeId: u.id,
      clockNumber: profile?.employeeNumber ?? "",
      lastName: u.lastName ?? "",
      firstName: u.firstName ?? "",
      role: titleCaseRole(u.role),
      accessLevel: accessLevel || "",
      department: departmentName,
      location: locationName,
      workingCompany: companyById.get(u.companyId ?? "") ?? "",
      payingCompany: companyById.get(profile?.payrollCompanyId ?? "") ?? "",
      payrollCompany: profile?.payrollProcessor ?? "",
      tax: profile?.taxClassification ?? "",
      paySetup: profile ? paySetupLabel(profile.payType) : "",
      payAmount: payAmountFor(profile),
      policies: (policiesByUser.get(u.id) ?? []).join(", "),
      lunch: profile ? (profile.requireLunchBreak ? "Required" : "Not required") : "",
      termination: u.deactivatedAt
        ? profile?.terminationDate ?? new Date(u.deactivatedAt).toISOString().slice(0, 10)
        : "",
    };
    const tabLocation = locationName || "Unassigned";
    built.push({ row, locationName: tabLocation });
  }

  // ---- Workbook ----
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ahava Time & Attendance";
  wb.created = new Date();

  // Dropdown sources. SHORT lists are embedded INLINE in each cell — Google
  // Sheets keeps these when the .xlsx is opened as a Google Sheet. A LONG list
  // (e.g. Department) can't fit inline, so it's written to a VISIBLE "Lists"
  // sheet and referenced by range: Google drops a range dropdown whose source
  // sheet is HIDDEN, so that sheet must stay visible. The importer skips any
  // sheet named "Lists", so it is never read as employee data. The Lists sheet
  // is created AFTER the data tabs (below) so the location tabs come first.
  const INLINE_LIMIT = 250;
  const dropSpecs: { col: ColId; values: string[] }[] = [
    { col: "role", values: ROLE_OPTIONS },
    { col: "accessLevel", values: Array.from(new Set(roles.filter((r) => !r.isSystem).map((r) => r.name))) },
    { col: "department", values: departments.map((d) => d.name) },
    { col: "location", values: locationsAll.map((l) => l.name) },
    { col: "workingCompany", values: WORKING_COMPANY_OPTIONS },
    { col: "payingCompany", values: PAYING_COMPANY_OPTIONS },
    { col: "payrollCompany", values: PAYROLL_COMPANY_OPTIONS },
    { col: "tax", values: TAX_OPTIONS },
    { col: "paySetup", values: PAY_SETUP_OPTIONS },
    { col: "lunch", values: LUNCH_OPTIONS },
  ];
  const colLetterFor = (n: number): string => {
    let s = "", x = n;
    while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
    return s;
  };
  // Per-column validation formula (an inline quoted list, or a =Lists!$X$.. range)
  // plus the long-list columns to write onto the visible Lists sheet afterwards.
  const formulaByCol = new Map<ColId, string>();
  const listColumns: { letter: string; header: string; values: string[] }[] = [];
  let listColIdx = 0;
  for (const spec of dropSpecs) {
    const clean = spec.values.map((v) => String(v).replace(/"/g, "").trim()).filter(Boolean);
    if (clean.length === 0) continue;
    const inline = clean.join(",");
    const canInline = inline.length <= INLINE_LIMIT && !clean.some((v) => v.includes(","));
    if (canInline) {
      formulaByCol.set(spec.col, `"${inline}"`);
    } else {
      listColIdx++;
      const letter = colLetterFor(listColIdx);
      listColumns.push({ letter, header: COLUMNS.find((c) => c.id === spec.col)?.header ?? spec.col, values: clean });
      formulaByCol.set(spec.col, `=Lists!$${letter}$2:$${letter}$${clean.length + 1}`);
    }
  }

  // Group rows by tab location, sorted by last name.
  const byTab = new Map<string, Row[]>();
  for (const b of built) {
    const arr = byTab.get(b.locationName) ?? [];
    arr.push(b.row);
    byTab.set(b.locationName, arr);
  }
  const usedNames = new Set<string>();
  // Stable, friendly tab order: named locations first (alphabetical), Unassigned last.
  const tabOrder = Array.from(byTab.keys()).sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });

  for (const tab of tabOrder) {
    const rows = (byTab.get(tab) ?? []).sort((a, b) =>
      String(a.lastName).localeCompare(String(b.lastName)) || String(a.firstName).localeCompare(String(b.firstName)),
    );
    const ws = wb.addWorksheet(safeSheetName(tab, usedNames), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.id, width: c.width, hidden: c.hidden }));
    // Header style.
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };

    rows.forEach((r) => ws.addRow(r));

    // Apply dropdown data validation to each configured column, for every data
    // row plus a buffer of blank rows so added rows still get the dropdown.
    const lastRow = Math.max(ws.rowCount, 1) + 200;
    for (const col of COLUMNS) {
      const formula = formulaByCol.get(col.id);
      if (!formula) continue;
      const colLetter = ws.getColumn(col.id).letter;
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: "warning",
          error: "Pick a value from the dropdown (or clear the cell).",
        };
      }
    }
  }

  // Visible "Lists" sheet holding the long dropdown lists (Department, etc.),
  // referenced by range above. Created after the data tabs so it sorts last.
  if (listColumns.length > 0) {
    const lists = wb.addWorksheet("Lists");
    for (const lc of listColumns) {
      lists.getCell(`${lc.letter}1`).value = lc.header;
      lc.values.forEach((v, i) => { lists.getCell(`${lc.letter}${i + 2}`).value = v; });
      lists.getColumn(lc.letter).width = 28;
    }
    lists.getRow(1).font = { bold: true };
  }

  // If nobody matched (empty system), still emit a usable empty tab.
  if (tabOrder.length === 0) {
    const ws = wb.addWorksheet("Employees");
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.id, width: c.width, hidden: c.hidden }));
    ws.getRow(1).font = { bold: true };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
