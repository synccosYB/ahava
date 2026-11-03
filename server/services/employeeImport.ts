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
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { userEmploymentProfiles, users, type Company } from "../../shared/schema";

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

/**
 * First word of the cell is the first name, the remaining word(s) are the last
 * name. A handful of rows use a "Last, First" comma form (e.g. "Aricapa,
 * Jorge"); we strip the stray comma so the stored name has no punctuation, but
 * still treat the first token as the first name.
 */
function parseName(raw: string): { firstName: string; lastName: string } {
  const cleaned = String(raw).trim().replace(/\s+/g, " ");
  const tokens = cleaned.split(" ");
  const firstName = (tokens[0] || "").replace(/,/g, "").trim();
  const lastName = tokens.slice(1).join(" ").replace(/,/g, "").trim();
  return { firstName, lastName };
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
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("The spreadsheet has no sheets.");
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

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
  const deactivated: { row: number; employeeNumber: string; name: string }[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const warnings: { row: number; reason: string }[] = [];

  let rowNum = 1;
  for (const row of rows) {
    rowNum++;
    // Clock # is the match key (employee number). Accept legacy "ID" too, but
    // never the zero-padded "Employee Id" or the "Payroll Id".
    const employeeNumber = pick(row, ["Clock #", "Clock#", "Clock Number", "ID"]);
    const employeeCell = pick(row, ["Employee Name", "Employee", "Name"]);
    const actualLocation = pick(row, ["Actual Location", "Work Location"]);
    const legacyDept = pick(row, ["Location", "Department Name", "Dept", "Department"]);
    const payingCompanyRaw = pick(row, ["Paying Company", "Payroll Company"]);
    const wageTypeRaw = pick(row, ["Wage Type", "Tax Classification", "Tax Form"]);
    // Department / Role only exist on the enriched owner sheet (which always
    // carries an explicit Actual Location). On legacy files the "Department"
    // column is actually a location label, so we only act on these when an
    // Actual Location is present — see `enriched` below.
    const departmentRaw = pick(row, ["Department", "Dept"]);
    const roleRaw = pick(row, ["Role", "Job Title", "Position"]);

    if (!employeeNumber) {
      skipped.push({ row: rowNum, reason: "missing Clock # / ID" });
      continue;
    }
    if (!employeeCell) {
      skipped.push({ row: rowNum, reason: `missing name (Clock # ${employeeNumber})` });
      continue;
    }

    // Resolve the work location: explicit Actual Location wins; otherwise fall
    // back to mapping the legacy department cell.
    let locationName = actualLocation;
    if (!locationName) {
      const mapped = LOCATION_NAME_MAP[legacyDept];
      if (!mapped) {
        skipped.push({
          row: rowNum,
          reason: `no Actual Location and unknown department "${legacyDept}" (Clock # ${employeeNumber})`,
        });
        continue;
      }
      locationName = mapped;
    }
    const locationId = await ensureLocation(locationName);
    const { firstName, lastName } = parseName(employeeCell);

    // Optional pay fields. Only set when the cell is present and recognized;
    // blank or unrecognized values warn and are left at the schema default.
    const profilePatch: { employeeNumber: string; payrollCompanyId?: string; taxClassification?: string } = {
      employeeNumber,
    };
    if (payingCompanyRaw) {
      const payId = resolvePayingCompany(payingCompanyRaw);
      if (payId) profilePatch.payrollCompanyId = payId;
      else warnings.push({ row: rowNum, reason: `unrecognized paying company "${payingCompanyRaw}" (Clock # ${employeeNumber}); left blank` });
    }
    if (wageTypeRaw) {
      const wt = normalizeWageType(wageTypeRaw);
      if (wt) profilePatch.taxClassification = wt;
      else warnings.push({ row: rowNum, reason: `unrecognized wage type "${wageTypeRaw}" (Clock # ${employeeNumber}); left at default` });
    }

    // Department / Role / Inactive are only meaningful on the enriched sheet.
    const enriched = !!actualLocation;
    const isInactiveCell = enriched && departmentRaw.trim().toLowerCase() === "inactive";

    // Resolve the department to an existing (global) department id. Blank and
    // "Inactive" are not departments; an unknown name warns and is left unset.
    let resolvedDepartmentId: string | undefined;
    if (enriched && departmentRaw && !isInactiveCell) {
      const did = departmentByName.get(departmentRaw.trim().toLowerCase());
      if (did) resolvedDepartmentId = did;
      else warnings.push({ row: rowNum, reason: `unknown department "${departmentRaw}" (Clock # ${employeeNumber}); left unassigned` });
    }

    // Resolve the role to an existing non-system role id; unknown warns.
    let resolvedRoleId: string | undefined;
    if (roleRaw) {
      const rid = roleByName.get(roleRaw.trim().toLowerCase());
      if (rid) resolvedRoleId = rid;
      else warnings.push({ row: rowNum, reason: `unknown role "${roleRaw}" (Clock # ${employeeNumber}); not assigned` });
    }

    const existingUserId = userIdByNumber.get(employeeNumber);
    let userId: string;
    if (existingUserId) {
      // Idempotent update: refresh name/company/location/pay, never duplicate.
      await storage.updateUser(existingUserId, {
        firstName,
        lastName,
        role: "employee",
        companyId,
      });
      await storage.setUserLocationIds(existingUserId, [locationId]);
      await storage.updateEmploymentProfile(existingUserId, profilePatch);
      userId = existingUserId;
      updated++;
    } else {
      const newUser = await storage.createUser({
        firstName,
        lastName,
        role: "employee",
        companyId,
      });
      await storage.setUserLocationIds(newUser.id, [locationId]);
      await storage.createEmploymentProfile({ userId: newUser.id, ...profilePatch });
      userIdByNumber.set(employeeNumber, newUser.id);
      deactivatedByNumber.set(employeeNumber, false);
      userId = newUser.id;
      created++;
    }

    // Department assignment (only when matched; blank/unknown leave the current
    // membership untouched so a partial sheet never wipes existing departments).
    if (resolvedDepartmentId) {
      await storage.setUserDepartmentIds(userId, [resolvedDepartmentId]);
      departmentsAssigned++;
    }

    // Role assignment (non-system roles only; idempotent — never double-assign).
    if (resolvedRoleId) {
      const current = await storage.getUserRoles(userId);
      if (!current.some((r) => r.roleId === resolvedRoleId)) {
        await storage.assignUserRole(userId, resolvedRoleId, companyId);
      }
      rolesAssigned++;
    }

    // Inactive -> deactivate. Only when not already deactivated, so a re-import
    // never resets a reason a human picked in the UI. We do NOT auto-reactivate
    // the reverse case; instead we surface it as a warning.
    if (isInactiveCell) {
      if (deactivatedByNumber.get(employeeNumber) !== true) {
        await storage.setUserDeactivated(userId, "import", null);
        deactivatedByNumber.set(employeeNumber, true);
        deactivated.push({ row: rowNum, employeeNumber, name: `${firstName} ${lastName}`.trim() });
      }
    } else if (enriched && deactivatedByNumber.get(employeeNumber) === true) {
      warnings.push({ row: rowNum, reason: `${firstName} ${lastName}`.trim() + ` (Clock # ${employeeNumber}) is deactivated in the system but the sheet lists it active; not reactivated automatically` });
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
    deactivated,
    skipped,
    warnings,
    profilesWithNumber,
  };
}
