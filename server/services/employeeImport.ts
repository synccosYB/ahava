/**
 * Reusable employee spreadsheet importer.
 *
 * Parses an uploaded .xlsx workbook and, for each row:
 *  - Ensures the operational company "Ahava Medical Center" exists.
 *  - Resolves the employee's WORK LOCATION. Preferred: an explicit
 *    "Actual Location" column (e.g. "Sumner"), created under the company if
 *    missing. Fallback (legacy files): the clock "Department" cell mapped to an
 *    approved location name via LOCATION_NAME_MAP.
 *  - Creates the employee (role `employee`, First/Last parsed from the cell) and
 *    stores the Clock # as the employment-profile employee number — the key that
 *    makes time-clock punches auto-attach to the right person.
 *  - Optionally sets the PAYING COMPANY ("Paying Company" column -> payrollCompanyId,
 *    matched to an existing company by name) and the WAGE TYPE ("Wage Type"
 *    column -> taxClassification: W-2 / 1099 / Volunteer).
 *  - Leaves email, password, department, and pay-rate fields empty. Blank
 *    Paying Company / Wage Type cells are left untouched (schema default), so the
 *    per-person "mix" rows can be filled in by hand later.
 *
 * Idempotent: matches existing employees on the stored employee number (scoped to
 * this company), so a second run UPDATES the name/location/pay fields instead of
 * creating duplicates.
 */
import XLSX from "xlsx";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { userEmploymentProfiles, users, policyAssignments, type Company, type InsertEmploymentProfile } from "../../shared/schema";
import { parseEmployeeName } from "./employeeNames";
import { isProtectedUser } from "./roleAssignment";

export const COMPANY_NAME = "Ahava Medical Center";

// Legacy fallback only: raw clock "Department" string -> approved location name,
// used when a file has no "Actual Location" column. New imports should carry an
// explicit Actual Location (e.g. "Sumner") instead of deriving it here.
export const LOCATION_NAME_MAP: Record<string, string> = {
  "Sumner ahava": "Sumner Ahava",
  "Sumner Ahava Other": "Sumner Ahava Other",
  "Ahava Liberty": "Ahava Liberty",
  "Sumner bcm": "Sumner BCM",
  Inwwod: "Inwood",
  "bcm other": "BCM Other",
  Monsey: "Monsey",
};

export interface ImportSummary {
  company: string;
  companyId: string;
  rowsParsed: number;
  locationsTotal: number;
  created: number;
  updated: number;
  /** Rows whose Department cell was a known department and got assigned. */
  departmentsAssigned: number;
  /** Rows whose Role cell matched an existing custom role and got assigned. */
  rolesAssigned: number;
  /** Rows whose Department cell was "Inactive" -> the employee was deactivated. */
  deactivated: { row: number; employeeNumber: string; name: string }[];
  /** Employees reactivated because their Termination Date was cleared. */
  reactivated: { row: number; name: string }[];
  /** Counts of the enriched round-trip fields that were applied. */
  baseRolesSet: number;
  payUpdated: number;
  lunchSet: number;
  workingCompanySet: number;
  policiesAdded: number;
  policiesRemoved: number;
  skipped: { row: number; reason: string }[];
  /** Non-fatal per-row notes (e.g. an unrecognized paying company, wage type,
   * department, or role that was left unset); the employee is still imported. */
  warnings: { row: number; reason: string }[];
  profilesWithNumber: number;
  /** True when this run computed changes WITHOUT writing them (preview). */
  dryRun: boolean;
  /** Per-row plain-language summary of what changed (or would change). */
  changes: { row: number; employeeNumber: string; name: string; actions: string[] }[];
}

export interface ImportOptions {
  /** Preview only — compute everything but write nothing to the database. */
  dryRun?: boolean;
  /** Never create new employees: a Clock # with no match is skipped + flagged. */
  updateOnly?: boolean;
}

/**
 * Case/space-insensitive column accessor. Returns the first non-empty cell among
 * the candidate header names, so both legacy headers ("Employee", "ID",
 * "Location") and the enriched sheet ("Employee Name", "Clock #", "Actual
 * Location", "Wage Type", "Paying Company") work without a fixed schema.
 */
function pick(row: Record<string, unknown>, candidates: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) byKey.set(norm(k), v);
  for (const c of candidates) {
    const v = byKey.get(norm(c));
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Normalize a wage-type cell to a stored taxClassification, or undefined when
 * blank/unrecognized (leave the schema default, don't guess). */
function normalizeWageType(raw: string): "W-2" | "1099" | "Volunteer" | undefined {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!v) return undefined;
  if (v === "w-2" || v === "w2") return "W-2";
  if (v === "1099") return "1099";
  if (v.startsWith("vol")) return "Volunteer";
  return undefined;
}

/** Base role cell ("Employee"/"Manager"/"Admin") -> stored users.role, or
 * undefined when blank/unrecognized (leave unchanged). */
function normalizeBaseRole(raw: string): "employee" | "manager" | "admin" | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "employee") return "employee";
  if (v === "manager") return "manager";
  if (v === "admin" || v === "administrator") return "admin";
  return undefined;
}

/** Pay-setup cell ("Hourly"/"Daily"/"Salary") -> stored payType, or undefined. */
function normalizePaySetup(raw: string): "hourly" | "daily" | "salary" | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "hourly") return "hourly";
  if (v === "daily") return "daily";
  if (v === "salary" || v === "weekly") return "salary";
  return undefined;
}

/** Lunch-break cell -> boolean, or undefined when blank/unrecognized. */
function normalizeLunch(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith("req")) return true; // "Required"
  if (v.startsWith("not") || v === "no" || v === "false") return false; // "Not required"
  return undefined;
}

/** Parse a pay-amount cell to a positive number, or undefined. Strips $ and commas. */
function normalizeAmount(raw: string): number | undefined {
  const value = raw.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parse a termination-date cell to an ISO yyyy-mm-dd string, or undefined.
 * Accepts yyyy-mm-dd, m/d/yyyy, and Excel serial date numbers. */
function normalizeDate(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const iso = usDate
    ? `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`
    : v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
  }
  // Excel serial date (days since 1899-12-30).
  if (/^\d{4,6}$/.test(v)) {
    const serial = parseInt(v, 10);
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

async function ensureCompany(): Promise<string> {
  const all = await storage.getAllCompanies();
  const existing = all.find(
    (c) => c.name.trim().toLowerCase() === COMPANY_NAME.toLowerCase(),
  );
  if (existing) return existing.id;
  const created = await storage.createCompany({ name: COMPANY_NAME });
  return created.id;
}

/**
 * Resolve a "Paying Company" cell to an existing company id. Matches by name:
 * anything containing "bcm" -> the BCM company; anything containing "ahava" ->
 * the Ahava Medical operational company. Never creates a company (payroll
 * companies are set up by hand); an unmatched value returns undefined so the
 * caller can warn and leave payrollCompanyId null.
 */
function makePayingCompanyResolver(companies: Company[], operationalId: string) {
  const byLower = companies.map((c) => ({ id: c.id, lower: c.name.trim().toLowerCase() }));
  const cache = new Map<string, string | undefined>();
  return (raw: string): string | undefined => {
    const key = raw.trim().toLowerCase();
    if (!key) return undefined;
    if (cache.has(key)) return cache.get(key);
    let id: string | undefined;
    if (key.includes("bcm")) {
      id = byLower.find((c) => c.lower.includes("bcm"))?.id;
    } else if (key.includes("ahava")) {
      id = byLower.find((c) => c.lower.includes("ahava medical"))?.id ?? operationalId;
    } else {
      id = byLower.find((c) => c.lower === key || c.lower.includes(key))?.id;
    }
    cache.set(key, id);
    return id;
  };
}

/**
 * Run the import against the provided .xlsx file contents. Throws if the
 * workbook can't be read; otherwise returns a structured summary.
 */
export async function importEmployeesFromBuffer(
  buffer: Buffer,
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const dryRun = opts.dryRun === true;
  const updateOnly = opts.updateOnly === true;
  const changes: ImportSummary["changes"] = [];
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (wb.SheetNames.length === 0) {
    throw new Error("The spreadsheet has no sheets.");
  }
  // Recognize the export format by its distinctive columns — "Access Level" (and
  // "Clock #") only appear on the exported workbook, never on a legacy clock
  // sheet. The hidden "Employee ID" column is NOT required: when it's absent
  // (e.g. the client worked from a copy that dropped it), we still apply the full
  // field set and match rows by Clock # instead. "Lists" is the dropdown sheet.
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    // Google Sheets (and hand-edited copies) can leave a blank banner row above
    // the headers. Object-mode parsing would turn that blank row into the header,
    // producing "__EMPTY" keys and dropping every real column, so first locate the
    // actual header row (the first row with any non-empty cell) and parse from it.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true });
    let headerRow = 0;
    while (
      headerRow < aoa.length &&
      (aoa[headerRow] ?? []).every((cell) => cell == null || String(cell).trim() === "")
    ) headerRow++;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      range: headerRow < aoa.length ? headerRow : 0,
    });
    const headers = Object.keys(rows[0] ?? {}).map((header) => header.trim().toLowerCase());
    const exported = name.trim().toLowerCase() !== "lists" &&
      ["clock #", "access level"].every((header) => headers.includes(header));
    return { rows, exported };
  });
  const exportedSheets = sheets.filter((sheet) => sheet.exported);
  const exportFormat = exportedSheets.length > 0;
  const rows = exportFormat ? exportedSheets.flatMap((sheet) => sheet.rows) : sheets[0].rows;

  const companyId = await ensureCompany();
  const allCompanies = await storage.getAllCompanies();
  const resolveLegacyPayingCompany = makePayingCompanyResolver(allCompanies, companyId);

  // Departments are a single GLOBAL list (name is globally unique), so we match
  // a "Department" cell to an existing department by trimmed, case-insensitive
  // name. We deliberately do NOT create departments here (unlike locations):
  // the owner curates the department list by hand, and the spreadsheet is full
  // of typos / trailing spaces ("Nuero", "LAB IN ", "Tranportation"). An
  // unmatched name warns and is left unassigned so the mess is surfaced, never
  // silently turned into a junk department.
  const allDepartments = await storage.getAllDepartments();
  const departmentByName = new Map<string, string>();
  for (const d of allDepartments) departmentByName.set(d.name.trim().toLowerCase(), d.id);

  // Roles: match a "Role" cell to an existing NON-SYSTEM role by name. System
  // roles (Super Admin, Company Admin, …) are permission-bearing and must never
  // be granted from a spreadsheet, so they are excluded from the lookup; an
  // unmatched role warns and is left unassigned (never created).
  const allRoles = await storage.getAllRoles();
  const roleByName = new Map<string, string>();
  for (const r of allRoles) {
    if (!r.isSystem) roleByName.set(r.name.trim().toLowerCase(), r.id);
  }

  // Working Company ("Working Company" cell) -> an existing company id, matched
  // by name. Never creates a company; an unmatched value warns and leaves the
  // current company. The operational default (Ahava Medical Center) is used when
  // the cell is blank on a NEW employee.
  const companyByName = new Map<string, string>();
  for (const c of allCompanies) companyByName.set(c.name.trim().toLowerCase(), c.id);

  // Policies ("Policies" cell, comma-separated) -> existing policy ids by name.
  // Round-trip is reconciling: user-scoped assignments are made to match the
  // listed set (add missing, remove unlisted). Only USER-scoped direct
  // assignments are touched — company/department/role-scoped policies are left
  // alone. Unknown names warn and are ignored.
  const allPolicies = await storage.getAllPolicies();
  const policyByName = new Map<string, string>();
  for (const p of allPolicies) {
    policyByName.set(p.name.trim().toLowerCase(), p.id);
  }
  // Current user-scoped policy assignments: userId -> (policyId -> assignmentId).
  const userPolicyRows = await db
    .select({ id: policyAssignments.id, userId: policyAssignments.userId, policyId: policyAssignments.policyId })
    .from(policyAssignments)
    .where(isNotNull(policyAssignments.userId));
  const userPolicies = new Map<string, Map<string, string>>();
  for (const r of userPolicyRows) {
    if (!r.userId) continue;
    const m = userPolicies.get(r.userId) ?? new Map<string, string>();
    m.set(r.policyId, r.id);
    userPolicies.set(r.userId, m);
  }

  // Location cache (cleaned name -> id), seeded from this company's locations so
  // a same-named location in another tenant is never reused.
  const existingLocations = await storage.getLocationsByCompany(companyId);
  const locationByName = new Map<string, string>(); // lowercase name -> id
  for (const l of existingLocations) locationByName.set(l.name.trim().toLowerCase(), l.id);
  const locationNames = new Map((exportFormat ? await storage.getAllLocations() : [])
    .map((location) => [location.id, location.name.trim().toLowerCase()]));
  const locationsByCompany = new Map([[companyId, existingLocations]]);
  async function ensureLocation(name: string): Promise<string> {
    const key = name.trim().toLowerCase();
    const found = locationByName.get(key);
    if (found) return found;
    const loc = await storage.createLocation({ companyId, name: name.trim() });
    locationByName.set(key, loc.id);
    return loc.id;
  }

  // Build a lookup of existing employees by stored employee number so the run
  // is idempotent. Scoped to THIS company (join users) so a matching employee
  // number in another company is never updated or moved across tenants.
  const existingProfiles = await db
    .select({
      userId: userEmploymentProfiles.userId,
      employeeNumber: userEmploymentProfiles.employeeNumber,
    })
    .from(userEmploymentProfiles)
    .innerJoin(users, eq(users.id, userEmploymentProfiles.userId))
    .where(eq(users.companyId, companyId));
  const userIdByNumber = new Map<string, string>();
  for (const p of existingProfiles) {
    if (p.employeeNumber) {
      userIdByNumber.set(p.employeeNumber, p.userId);
    }
  }

  let created = 0;
  let updated = 0;
  let departmentsAssigned = 0;
  let rolesAssigned = 0;
  let baseRolesSet = 0;
  let payUpdated = 0;
  let lunchSet = 0;
  let workingCompanySet = 0;
  let policiesAdded = 0;
  let policiesRemoved = 0;
  const deactivated: { row: number; employeeNumber: string; name: string }[] = [];
  const reactivated: { row: number; name: string }[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const warnings: { row: number; reason: string }[] = [];

  let rowNum = 1;
  for (const row of rows) {
    rowNum++;
    // The export's hidden key (user id) is the most reliable match; Clock #
    // (employee number) is the fallback and the key for brand-new rows.
    const idCell = exportFormat ? pick(row, ["Employee ID"]) : "";
    const employeeNumber = pick(row, ["Clock #", "Clock#", "Clock Number", "ID"]);
    const employeeCell = pick(row, ["Employee Name", "Employee", "Name"]);
    const explicitFirstName = pick(row, ["First Name", "FirstName", "Given Name"]);
    const explicitLastName = pick(row, ["Last Name", "LastName", "Surname", "Family Name"]);
    const payingCompanyRaw = pick(row, exportFormat ? ["Paying Company"] : ["Paying Company", "Payroll Company"]);
    const wageTypeRaw = pick(row, ["Tax Classification", "Wage Type", "Tax Form"]);
    const departmentRaw = pick(row, ["Department", "Dept"]);
    const workingCompanyRaw = pick(row, ["Working Company"]);
    // Export: "Role" = base role, "Access Level" = custom role. Legacy: "Role"
    // was the custom role.
    const baseRoleRaw = exportFormat ? pick(row, ["Role"]) : "";
    const accessLevelRaw = exportFormat ? pick(row, ["Access Level"]) : pick(row, ["Role", "Job Title", "Position"]);
    const paySetupRaw = pick(row, ["Pay Setup", "Pay Type"]);
    const payAmountRaw = pick(row, ["Pay Amount"]);
    const lunchRaw = pick(row, ["Lunch Break"]);
    const terminationRaw = pick(row, ["Termination Date", "Termination"]);
    const policiesRaw = pick(row, ["Policies"]);

    // Resolve the match target. Employee ID wins; then Clock #.
    const matchedUserId = idCell || userIdByNumber.get(employeeNumber);
    const existingUser = matchedUserId ? await storage.getUser(matchedUserId) : undefined;
    const existingUserId = existingUser?.id;
    if (idCell && !existingUserId) {
      skipped.push({ row: rowNum, reason: "Employee ID no longer exists; export a fresh workbook" });
      continue;
    }
    if (existingUserId && isProtectedUser(existingUserId)) {
      skipped.push({ row: rowNum, reason: "this account cannot be changed through employee import" });
      continue;
    }

    // Update-only mode: never create — a Clock # that matches no one is skipped
    // and flagged, so a typo'd clock number can't become a duplicate employee.
    if (!existingUserId && updateOnly) {
      skipped.push({
        row: rowNum,
        reason: employeeNumber
          ? `Clock # ${employeeNumber} not found — update-only, skipped`
          : "no matching employee and missing Clock # — skipped",
      });
      continue;
    }

    // A row with no match needs a Clock # (its future key) and a name to create.
    if (!existingUserId) {
      if (!employeeNumber) {
        skipped.push({ row: rowNum, reason: "no Employee ID match and missing Clock #" });
        continue;
      }
      if (!employeeCell && !explicitFirstName && !explicitLastName) {
        skipped.push({ row: rowNum, reason: `missing name (Clock # ${employeeNumber})` });
        continue;
      }
    }

    // The exported Location cell represents the primary location. Existing
    // secondary memberships are kept when that primary location changes.
    const locCellRaw = exportFormat
      ? pick(row, ["Location", "Actual Location", "Work Location"])
      : pick(row, ["Actual Location", "Work Location"]);
    let locationName = locCellRaw.trim();
    if (!locationName && !exportFormat) {
      locationName = LOCATION_NAME_MAP[pick(row, ["Location", "Department Name", "Dept", "Department"])] || "";
    }
    if (!locationName && !existingUserId) {
      skipped.push({ row: rowNum, reason: `new employee has no usable Location (Clock # ${employeeNumber})` });
      continue;
    }
    const { firstName, lastName } = explicitFirstName || explicitLastName
      ? { firstName: explicitFirstName, lastName: explicitLastName }
      : parseEmployeeName(employeeCell);

    // Working company -> operational companyId. Match by name; default Ahava.
    let resolvedCompanyId = existingUser ? existingUser.companyId : companyId;
    if (workingCompanyRaw) {
      const wc = companyByName.get(workingCompanyRaw.trim().toLowerCase());
      if (wc) resolvedCompanyId = wc;
      else warnings.push({ row: rowNum, reason: `unknown working company "${workingCompanyRaw}"; left unchanged` });
    }

    let locationIds: string[] | undefined;
    if (locationName && !exportFormat) {
      locationIds = [await ensureLocation(locationName)];
    } else if (locationName) {
      const currentIds = existingUserId ? await storage.getUserLocationIds(existingUserId) : [];
      const currentPrimary = currentIds.find((id) => id === existingUser?.locationId) ?? currentIds[0];
      const name = locationName.toLowerCase();
      const currentMatch = currentIds.find((id) => locationNames.get(id) === name);
      if (!currentMatch) {
        const workCompany = resolvedCompanyId ?? companyId;
        const available = locationsByCompany.get(workCompany) ?? await storage.getLocationsByCompany(workCompany);
        locationsByCompany.set(workCompany, available);
        const candidates = available.filter((location) => location.name.trim().toLowerCase() === name);
        if (candidates.length === 1) {
          locationIds = [candidates[0].id, ...currentIds.filter((id) => id !== currentPrimary)];
        } else {
          warnings.push({ row: rowNum, reason: `unknown or ambiguous location "${locationName}"; left unchanged` });
        }
      } else if (currentMatch !== currentPrimary) {
        locationIds = [currentMatch, ...currentIds.filter((id) => id !== currentMatch)];
      }
    }
    if (!existingUser && !locationIds) {
      skipped.push({ row: rowNum, reason: `new employee has no usable Location (Clock # ${employeeNumber})` });
      continue;
    }

    // Employment-profile patch. Only set fields whose cell is present+recognized.
    const existingProfile = existingUserId ? await storage.getEmploymentProfile(existingUserId) : undefined;
    const profilePatch: Partial<InsertEmploymentProfile> = {};
    if (employeeNumber) profilePatch.employeeNumber = employeeNumber;
    if (payingCompanyRaw) {
      const payId = companyByName.get(payingCompanyRaw.trim().toLowerCase()) ?? resolveLegacyPayingCompany(payingCompanyRaw);
      if (payId) profilePatch.payrollCompanyId = payId;
      else warnings.push({ row: rowNum, reason: `unrecognized paying company "${payingCompanyRaw}"; left unchanged` });
    }
    if (wageTypeRaw) {
      const wt = normalizeWageType(wageTypeRaw);
      if (wt) profilePatch.taxClassification = wt;
      else warnings.push({ row: rowNum, reason: `unrecognized tax classification "${wageTypeRaw}"; left unchanged` });
    }
    const currentBasis = existingProfile?.payType ?? "hourly";
    const basis = paySetupRaw ? normalizePaySetup(paySetupRaw) : normalizePaySetup(currentBasis);
    const amount = normalizeAmount(payAmountRaw);
    const changesBasis = !!paySetupRaw && basis !== currentBasis;
    let payTouched = false;
    if (paySetupRaw && !basis) {
      warnings.push({ row: rowNum, reason: `unrecognized pay setup "${paySetupRaw}"; left unchanged` });
    } else if (payAmountRaw && amount === undefined) {
      warnings.push({ row: rowNum, reason: "invalid pay amount; pay left unchanged" });
    } else if (changesBasis && existingProfile && amount === undefined) {
      warnings.push({ row: rowNum, reason: "a new pay amount is required to change the pay setup" });
    } else if (basis && amount !== undefined) {
      profilePatch.payType = basis;
      if (changesBasis) {
        profilePatch.hourlyRate = null;
        profilePatch.dailySalary = null;
        profilePatch.weeklySalary = null;
      }
      const rate = basis === "daily" ? "dailySalary" : basis === "salary" ? "weeklySalary" : "hourlyRate";
      profilePatch[rate] = amount;
      payTouched = true;
    } else if (basis && changesBasis) {
      profilePatch.payType = basis;
      payTouched = true;
    }
    let lunchVal: boolean | undefined;
    if (lunchRaw) {
      lunchVal = normalizeLunch(lunchRaw);
      if (lunchVal !== undefined) profilePatch.requireLunchBreak = lunchVal;
      else warnings.push({ row: rowNum, reason: `unrecognized lunch break "${lunchRaw}"; left unchanged` });
    }

    // Department: match to an existing global department. "Inactive" (legacy) is
    // handled below, not here.
    const isLegacyInactive = !exportFormat && !!locCellRaw && departmentRaw.trim().toLowerCase() === "inactive";
    let resolvedDepartmentId: string | undefined;
    if ((exportFormat || locCellRaw) && departmentRaw && !isLegacyInactive) {
      const did = departmentByName.get(departmentRaw.trim().toLowerCase());
      if (did) resolvedDepartmentId = did;
      else warnings.push({ row: rowNum, reason: `unknown department "${departmentRaw}"; left unassigned` });
    }

    // Access level -> an existing non-system role.
    let resolvedRoleId: string | undefined;
    if (accessLevelRaw) {
      const rid = roleByName.get(accessLevelRaw.trim().toLowerCase());
      if (rid) resolvedRoleId = rid;
      else warnings.push({ row: rowNum, reason: `unknown access level "${accessLevelRaw}"; not assigned` });
    }

    // Base role (export only): Employee / Manager / Admin.
    let resolvedBaseRole: "employee" | "manager" | "admin" | undefined;
    if (baseRoleRaw) {
      resolvedBaseRole = normalizeBaseRole(baseRoleRaw);
      if (!resolvedBaseRole) warnings.push({ row: rowNum, reason: `unknown role "${baseRoleRaw}"; left unchanged` });
    }

    // ---- Apply ----
    // rowActions records, in plain language, every field this row changes — used
    // for the dry-run preview and the final report.
    const rowActions: string[] = [];
    if (existingUser && (employeeCell || explicitFirstName || explicitLastName)) {
      const newName = `${firstName} ${lastName}`.trim();
      const oldName = `${existingUser.firstName ?? ""} ${existingUser.lastName ?? ""}`.trim();
      if (newName && newName !== oldName) rowActions.push(`name → ${newName}`);
    }
    if (resolvedBaseRole) rowActions.push(`base role → ${resolvedBaseRole}`);
    if (profilePatch.payrollCompanyId && payingCompanyRaw) rowActions.push(`paying company → ${payingCompanyRaw.trim()}`);
    if (profilePatch.taxClassification) rowActions.push(`tax → ${profilePatch.taxClassification}`);
    if (payTouched) rowActions.push(`pay → ${profilePatch.payType ?? basis}${amount !== undefined ? ` $${amount}` : ""}`);
    if (lunchVal !== undefined) rowActions.push(`lunch → ${lunchVal ? "required" : "not required"}`);
    if (locationIds && locationName) rowActions.push(`location → ${locationName}`);
    if (resolvedDepartmentId && departmentRaw) rowActions.push(`department → ${departmentRaw.trim()}`);
    if (resolvedRoleId && accessLevelRaw) rowActions.push(`access level → ${accessLevelRaw.trim()}`);
    if (workingCompanyRaw && companyByName.has(workingCompanyRaw.trim().toLowerCase())) rowActions.push(`working company → ${workingCompanyRaw.trim()}`);

    let userId: string;
    const wasDeactivated = !!existingUser?.deactivatedAt;
    if (existingUserId) {
      const userPatch: Record<string, unknown> = { companyId: resolvedCompanyId };
      if (employeeCell || explicitFirstName) userPatch.firstName = firstName;
      if (employeeCell || explicitLastName) userPatch.lastName = lastName;
      if (resolvedBaseRole) { userPatch.role = resolvedBaseRole; baseRolesSet++; }
      if (!dryRun) {
        await storage.updateUser(existingUserId, userPatch);
        if (locationIds) await storage.setUserLocationIds(existingUserId, locationIds);
        if (Object.keys(profilePatch).length > 0) {
          if (existingProfile) await storage.updateEmploymentProfile(existingUserId, profilePatch);
          else await storage.createEmploymentProfile({ ...profilePatch, userId: existingUserId });
        }
      }
      userId = existingUserId;
      updated++;
    } else {
      // (reached only when updateOnly is off — a genuine new hire)
      userId = `(new:${employeeNumber})`;
      if (!dryRun) {
        const newUser = await storage.createUser({
          firstName, lastName, role: resolvedBaseRole ?? "employee", companyId: resolvedCompanyId,
        });
        if (locationIds) await storage.setUserLocationIds(newUser.id, locationIds);
        await storage.createEmploymentProfile({ userId: newUser.id, ...profilePatch });
        userId = newUser.id;
      }
      if (resolvedBaseRole) baseRolesSet++;
      rowActions.unshift("CREATE new employee");
      created++;
    }
    if (employeeNumber && !userId.startsWith("(new")) userIdByNumber.set(employeeNumber, userId);
    if (workingCompanyRaw && companyByName.has(workingCompanyRaw.trim().toLowerCase())) workingCompanySet++;
    if (payTouched) payUpdated++;
    if (lunchVal !== undefined) lunchSet++;

    if (resolvedDepartmentId) {
      if (!dryRun && !userId.startsWith("(new")) await storage.setUserDepartmentIds(userId, [resolvedDepartmentId]);
      departmentsAssigned++;
    }
    if (resolvedRoleId && !userId.startsWith("(new")) {
      const current = await storage.getUserRoles(userId);
      if (!current.some((r) => r.roleId === resolvedRoleId)) {
        if (!dryRun) await storage.assignUserRole(userId, resolvedRoleId, resolvedCompanyId ?? undefined);
      }
      rolesAssigned++;
    }

    // Policies (export, "fully editable"): reconcile the user's DIRECT (user-
    // scoped) assignments to match the listed set. Only user-scoped rows are
    // touched; company/department/role-scoped policies are never removed.
    if (exportFormat && policiesRaw !== "") {
      const exactName = policyByName.get(policiesRaw.toLowerCase());
      const names = exactName ? [policiesRaw] : policiesRaw.split(",").map((name) => name.trim());
      const unknown = names.find((name) => !policyByName.has(name.toLowerCase()));
      if (unknown !== undefined) {
        warnings.push({ row: rowNum, reason: `unknown policy "${unknown}"; policy assignments left unchanged` });
      } else {
        const wanted = new Set(names.map((name) => policyByName.get(name.toLowerCase())!));
        const current = userPolicies.get(userId) ?? new Map<string, string>();
        let added = 0, removed = 0;
        for (const pid of wanted) {
          if (!current.has(pid)) {
            if (!dryRun) {
              const assignment = await storage.createPolicyAssignment({ policyId: pid, userId });
              current.set(pid, assignment.id);
            } else {
              current.set(pid, `(dry:${pid})`);
            }
            policiesAdded++; added++;
          }
        }
        for (const [pid, assignmentId] of current) {
          if (!wanted.has(pid)) {
            if (!dryRun) await storage.deletePolicyAssignment(assignmentId);
            current.delete(pid);
            policiesRemoved++; removed++;
          }
        }
        userPolicies.set(userId, current);
        if (added || removed) rowActions.push(`policies → set to "${names.join(", ")}" (+${added}/-${removed})`);
      }
    }

    // Deactivation / reactivation.
    // Legacy: a "Inactive" department cell deactivates. Export: a Termination
    // Date deactivates; clearing it reactivates.
    const terminationDate = exportFormat ? normalizeDate(terminationRaw) : undefined;
    const hasTerminationColumn = Object.keys(row).some((key) => key.trim().toLowerCase() === "termination date");
    if (exportFormat && terminationRaw && !terminationDate) {
      warnings.push({ row: rowNum, reason: "invalid termination date; employment status left unchanged" });
    } else if (isLegacyInactive || terminationDate) {
      if (!wasDeactivated && !userId.startsWith("(new")) {
        if (!dryRun) {
          await db.transaction(async (tx) => {
            if (terminationDate) await storage.updateEmploymentProfile(userId, { terminationDate }, tx);
            await storage.setUserDeactivated(userId, "import", null, tx);
          });
        }
        deactivated.push({ row: rowNum, employeeNumber, name: `${firstName} ${lastName}`.trim() });
        rowActions.push(`DEACTIVATE${terminationDate ? ` (termination ${terminationDate})` : ""}`);
      }
    } else if (exportFormat && idCell && hasTerminationColumn && wasDeactivated && !userId.startsWith("(new")) {
      // Export row with an empty Termination Date for a currently-deactivated
      // person -> reactivate (clear the termination).
      if (!dryRun) {
        await db.transaction(async (tx) => {
          await tx.update(users)
            .set({ deactivatedAt: null, terminationReason: null, updatedAt: new Date() })
            .where(eq(users.id, userId));
          await storage.updateEmploymentProfile(userId, { terminationDate: null }, tx);
        });
      }
      reactivated.push({ row: rowNum, name: `${firstName} ${lastName}`.trim() });
      rowActions.push("REACTIVATE");
    }

    if (rowActions.length > 0) {
      changes.push({ row: rowNum, employeeNumber, name: `${firstName} ${lastName}`.trim(), actions: rowActions });
    }
  }

  const companyLocations = await storage.getLocationsByCompany(companyId);
  const profilesWithNumber = (
    await db
      .select({ employeeNumber: userEmploymentProfiles.employeeNumber })
      .from(userEmploymentProfiles)
      .innerJoin(users, eq(users.id, userEmploymentProfiles.userId))
      .where(eq(users.companyId, companyId))
  ).filter((p) => p.employeeNumber).length;

  return {
    company: COMPANY_NAME,
    companyId,
    rowsParsed: rows.length,
    locationsTotal: companyLocations.length,
    created,
    updated,
    departmentsAssigned,
    rolesAssigned,
    baseRolesSet,
    payUpdated,
    lunchSet,
    workingCompanySet,
    policiesAdded,
    policiesRemoved,
    deactivated,
    reactivated,
    skipped,
    warnings,
    profilesWithNumber,
    dryRun,
    changes,
  };
}
