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
import { userEmploymentProfiles, users, policyAssignments, policies as policiesTable, type Company } from "../../shared/schema";
import { parseEmployeeName } from "./employeeNames";

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
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parse a termination-date cell to an ISO yyyy-mm-dd string, or undefined.
 * Accepts yyyy-mm-dd, m/d/yyyy, and Excel serial date numbers. */
function normalizeDate(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Excel serial date (days since 1899-12-30).
  if (/^\d{4,6}$/.test(v)) {
    const serial = parseInt(v, 10);
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
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
): Promise<ImportSummary> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (wb.SheetNames.length === 0) {
    throw new Error("The spreadsheet has no sheets.");
  }
  // The export writes one tab PER LOCATION plus a hidden "Lists" sheet that backs
  // the dropdowns. Gather rows from every data tab (skip "Lists"); a legacy
  // single-sheet file just yields that one sheet's rows.
  const rows: Record<string, unknown>[] = [];
  for (const sn of wb.SheetNames) {
    if (sn.trim().toLowerCase() === "lists") continue;
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sn], { defval: null });
    for (const r of sheetRows) rows.push(r);
  }
  // Detect the enriched EXPORT format by its hidden key column. In that format
  // "Role" = base role (Employee/Manager/Admin) and "Access Level" = the custom
  // permission role; in legacy files "Role" meant the custom role.
  const exportFormat = rows.some((r) =>
    Object.keys(r).some((k) => k.trim().toLowerCase() === "employee id"),
  );

  const companyId = await ensureCompany();
  const allCompanies = await storage.getAllCompanies();
  const resolvePayingCompany = makePayingCompanyResolver(allCompanies, companyId);

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
  const allCompaniesForWork = await storage.getAllCompanies();
  const companyByName = new Map<string, string>();
  for (const c of allCompaniesForWork) companyByName.set(c.name.trim().toLowerCase(), c.id);

  // Policies ("Policies" cell, comma-separated) -> existing policy ids by name.
  // Round-trip is reconciling: user-scoped assignments are made to match the
  // listed set (add missing, remove unlisted). Only USER-scoped direct
  // assignments are touched — company/department/role-scoped policies are left
  // alone. Unknown names warn and are ignored.
  const allPolicies = await storage.getAllPolicies();
  const policyByName = new Map<string, string>();
  const policyNameById = new Map<string, string>();
  for (const p of allPolicies) {
    policyByName.set(p.name.trim().toLowerCase(), p.id);
    policyNameById.set(p.id, p.name);
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
      deactivatedAt: users.deactivatedAt,
    })
    .from(userEmploymentProfiles)
    .innerJoin(users, eq(users.id, userEmploymentProfiles.userId))
    .where(eq(users.companyId, companyId));
  const userIdByNumber = new Map<string, string>();
  const deactivatedByNumber = new Map<string, boolean>();
  for (const p of existingProfiles) {
    if (p.employeeNumber) {
      userIdByNumber.set(p.employeeNumber, p.userId);
      deactivatedByNumber.set(p.employeeNumber, !!p.deactivatedAt);
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
    const idCell = pick(row, ["Employee ID", "EmployeeId", "User ID"]);
    const employeeNumber = pick(row, ["Clock #", "Clock#", "Clock Number", "ID"]);
    const employeeCell = pick(row, ["Employee Name", "Employee", "Name"]);
    const explicitFirstName = pick(row, ["First Name", "FirstName", "Given Name"]);
    const explicitLastName = pick(row, ["Last Name", "LastName", "Surname", "Family Name"]);
    const payingCompanyRaw = pick(row, ["Paying Company"]);
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
    let existingUserId: string | undefined;
    if (idCell) {
      const u = await storage.getUser(idCell);
      if (u) existingUserId = u.id;
    }
    if (!existingUserId && employeeNumber) existingUserId = userIdByNumber.get(employeeNumber);

    // A row with no match needs a Clock # (its future key) and a name to create.
    if (!existingUserId) {
      if (idCell && !employeeNumber) {
        warnings.push({ row: rowNum, reason: `Employee ID "${idCell}" no longer exists and no Clock # to create from; row skipped` });
        continue;
      }
      if (!employeeNumber) {
        skipped.push({ row: rowNum, reason: "no Employee ID match and missing Clock #" });
        continue;
      }
      if (!employeeCell && !explicitFirstName && !explicitLastName) {
        skipped.push({ row: rowNum, reason: `missing name (Clock # ${employeeNumber})` });
        continue;
      }
    }

    // Work location: export uses the "Location" cell (first of a comma list);
    // legacy uses "Actual Location" or the mapped department label. Blank is OK
    // for an existing employee (membership left as-is); a NEW employee needs one.
    const locCellRaw = exportFormat
      ? pick(row, ["Location", "Actual Location", "Work Location"])
      : pick(row, ["Actual Location", "Work Location"]);
    let locationName = locCellRaw.split(",")[0].trim();
    if (!locationName && !exportFormat) {
      locationName = LOCATION_NAME_MAP[pick(row, ["Location", "Department Name", "Dept", "Department"])] || "";
    }
    if (!locationName && !existingUserId) {
      skipped.push({ row: rowNum, reason: `new employee has no usable Location (Clock # ${employeeNumber})` });
      continue;
    }
    const locationId = locationName ? await ensureLocation(locationName) : undefined;

    const { firstName, lastName } = explicitFirstName || explicitLastName
      ? { firstName: explicitFirstName, lastName: explicitLastName }
      : parseEmployeeName(employeeCell);

    // Working company -> operational companyId. Match by name; default Ahava.
    let resolvedCompanyId = companyId;
    if (workingCompanyRaw) {
      const wc = companyByName.get(workingCompanyRaw.trim().toLowerCase());
      if (wc) resolvedCompanyId = wc;
      else warnings.push({ row: rowNum, reason: `unknown working company "${workingCompanyRaw}"; left at Ahava Medical Center` });
    }

    // Employment-profile patch. Only set fields whose cell is present+recognized.
    const profilePatch: Record<string, unknown> = { employeeNumber: employeeNumber || undefined };
    if (payingCompanyRaw) {
      const payId = resolvePayingCompany(payingCompanyRaw);
      if (payId) profilePatch.payrollCompanyId = payId;
      else warnings.push({ row: rowNum, reason: `unrecognized paying company "${payingCompanyRaw}"; left unchanged` });
    }
    if (wageTypeRaw) {
      const wt = normalizeWageType(wageTypeRaw);
      if (wt) profilePatch.taxClassification = wt;
      else warnings.push({ row: rowNum, reason: `unrecognized tax classification "${wageTypeRaw}"; left unchanged` });
    }
    let payTouched = false;
    if (paySetupRaw) {
      const pt = normalizePaySetup(paySetupRaw);
      if (pt) {
        profilePatch.payType = pt;
        const amt = normalizeAmount(payAmountRaw);
        if (amt !== undefined) {
          // Clear the other amount fields so the pay basis is unambiguous.
          profilePatch.hourlyRate = pt === "hourly" ? amt : null;
          profilePatch.dailySalary = pt === "daily" ? amt : null;
          profilePatch.weeklySalary = pt === "salary" ? amt : null;
        }
        payTouched = true;
      } else warnings.push({ row: rowNum, reason: `unrecognized pay setup "${paySetupRaw}"; left unchanged` });
    } else if (payAmountRaw) {
      // Amount given without a pay setup: apply to the existing pay basis later.
      const amt = normalizeAmount(payAmountRaw);
      if (amt !== undefined) { profilePatch.__amountOnly = amt; }
    }
    let lunchVal: boolean | undefined;
    if (lunchRaw) {
      lunchVal = normalizeLunch(lunchRaw);
      if (lunchVal !== undefined) profilePatch.requireLunchBreak = lunchVal;
      else warnings.push({ row: rowNum, reason: `unrecognized lunch break "${lunchRaw}"; left unchanged` });
    }

    // Department: match to an existing global department. "Inactive" (legacy) is
    // handled below, not here.
    const isLegacyInactive = !exportFormat && departmentRaw.trim().toLowerCase() === "inactive";
    let resolvedDepartmentId: string | undefined;
    if (departmentRaw && !isLegacyInactive) {
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
    let userId: string;
    const wasDeactivated = existingUserId ? (deactivatedByNumber.get(employeeNumber) ?? !!(await storage.getUser(existingUserId))?.deactivatedAt) : false;
    if (existingUserId) {
      const userPatch: Record<string, unknown> = { firstName, lastName, companyId: resolvedCompanyId };
      if (resolvedBaseRole) { userPatch.role = resolvedBaseRole; baseRolesSet++; }
      await storage.updateUser(existingUserId, userPatch);
      if (locationId) await storage.setUserLocationIds(existingUserId, [locationId]);
      // Amount-only (no pay setup): fill the field matching the current basis.
      if (profilePatch.__amountOnly !== undefined) {
        const cur = await storage.getEmploymentProfile(existingUserId);
        const basis = cur?.payType ?? "hourly";
        profilePatch[basis === "daily" ? "dailySalary" : basis === "salary" ? "weeklySalary" : "hourlyRate"] = profilePatch.__amountOnly;
        payTouched = true;
      }
      delete profilePatch.__amountOnly;
      await storage.updateEmploymentProfile(existingUserId, profilePatch);
      userId = existingUserId;
      updated++;
    } else {
      const newUser = await storage.createUser({
        firstName, lastName, role: resolvedBaseRole ?? "employee", companyId: resolvedCompanyId,
      });
      if (resolvedBaseRole) baseRolesSet++;
      if (locationId) await storage.setUserLocationIds(newUser.id, [locationId]);
      delete profilePatch.__amountOnly;
      await storage.createEmploymentProfile({ userId: newUser.id, ...profilePatch });
      if (employeeNumber) userIdByNumber.set(employeeNumber, newUser.id);
      deactivatedByNumber.set(employeeNumber, false);
      userId = newUser.id;
      created++;
    }
    if (workingCompanyRaw && companyByName.has(workingCompanyRaw.trim().toLowerCase())) workingCompanySet++;
    if (payTouched) payUpdated++;
    if (lunchVal !== undefined) lunchSet++;

    if (resolvedDepartmentId) {
      await storage.setUserDepartmentIds(userId, [resolvedDepartmentId]);
      departmentsAssigned++;
    }
    if (resolvedRoleId) {
      const current = await storage.getUserRoles(userId);
      if (!current.some((r) => r.roleId === resolvedRoleId)) {
        await storage.assignUserRole(userId, resolvedRoleId, resolvedCompanyId);
      }
      rolesAssigned++;
    }

    // Policies (export, "fully editable"): reconcile the user's DIRECT (user-
    // scoped) assignments to match the listed set. Only user-scoped rows are
    // touched; company/department/role-scoped policies are never removed.
    if (exportFormat && policiesRaw !== "") {
      const wanted = new Set<string>();
      for (const nm of policiesRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const pid = policyByName.get(nm.toLowerCase());
        if (pid) wanted.add(pid);
        else warnings.push({ row: rowNum, reason: `unknown policy "${nm}"; ignored` });
      }
      const current = userPolicies.get(userId) ?? new Map<string, string>();
      for (const pid of wanted) {
        if (!current.has(pid)) {
          const a = await storage.createPolicyAssignment({ policyId: pid, userId });
          current.set(pid, a.id);
          policiesAdded++;
        }
      }
      for (const [pid, assignmentId] of current) {
        if (!wanted.has(pid)) {
          await storage.deletePolicyAssignment(assignmentId);
          current.delete(pid);
          policiesRemoved++;
        }
      }
      userPolicies.set(userId, current);
    }

    // Deactivation / reactivation.
    // Legacy: a "Inactive" department cell deactivates. Export: a Termination
    // Date deactivates; clearing it reactivates.
    const terminationDate = exportFormat ? normalizeDate(terminationRaw) : undefined;
    if (isLegacyInactive || terminationDate) {
      if (!wasDeactivated) {
        await storage.setUserDeactivated(userId, "import", terminationDate ?? null);
        if (terminationDate) await storage.updateEmploymentProfile(userId, { terminationDate });
        deactivatedByNumber.set(employeeNumber, true);
        deactivated.push({ row: rowNum, employeeNumber, name: `${firstName} ${lastName}`.trim() });
      }
    } else if (exportFormat && !terminationRaw.trim() && wasDeactivated) {
      // Export row with an empty Termination Date for a currently-deactivated
      // person -> reactivate (clear the termination).
      await storage.updateUser(userId, { deactivatedAt: null, terminationReason: null });
      await storage.updateEmploymentProfile(userId, { terminationDate: null });
      deactivatedByNumber.set(employeeNumber, false);
      reactivated.push({ row: rowNum, name: `${firstName} ${lastName}`.trim() });
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
  };
}
