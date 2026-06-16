/**
 * Reusable employee spreadsheet importer.
 *
 * Parses an uploaded .xlsx workbook (same shape as the original Ahava employee
 * list) and, for each row:
 *  - Ensures the company "Ahava Medical Center" exists (create if missing).
 *  - Ensures each cleaned location exists under that company (raw -> cleaned).
 *  - Creates the employee (role `employee`, First/Last parsed from the cell),
 *    stores the spreadsheet ID as the employment-profile employee number, and
 *    links the employee to their location via both the many-to-many membership
 *    and the legacy single-location column.
 *  - Leaves email, password, department, and pay fields empty.
 *
 * Idempotent: matches existing employees on the stored employee number, so a
 * second run UPDATES the name/company/location instead of creating duplicates.
 */
import XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { userEmploymentProfiles, users } from "../../shared/schema";

export const COMPANY_NAME = "Ahava Medical Center";

// Raw location string in the file -> approved cleaned name.
export const LOCATION_NAME_MAP: Record<string, string> = {
  "Sumner ahava": "Sumner Ahava",
  "Sumner Ahava Other": "Sumner Ahava Other",
  "Ahava Liberty": "Ahava Liberty",
  "Sumner bcm": "Sumner BCM",
  Inwwod: "Inwood",
  "bcm other": "BCM Other",
  Monsey: "Monsey",
};

interface Row {
  Employee: string;
  ID: string | number;
  Dept: string | number;
  Location: string;
}

export interface ImportSummary {
  company: string;
  companyId: string;
  rowsParsed: number;
  locationsTotal: number;
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  profilesWithNumber: number;
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

async function ensureCompany(): Promise<string> {
  const all = await storage.getAllCompanies();
  const existing = all.find(
    (c) => c.name.trim().toLowerCase() === COMPANY_NAME.toLowerCase(),
  );
  if (existing) return existing.id;
  const created = await storage.createCompany({ name: COMPANY_NAME });
  return created.id;
}

async function ensureLocations(
  companyId: string,
): Promise<Map<string, string>> {
  // Scope to THIS company so a same-named location in another company can never
  // be reused — otherwise an import could bind employees to the wrong tenant.
  const existing = await storage.getLocationsByCompany(companyId);
  const byName = new Map<string, string>();
  for (const l of existing) byName.set(l.name.trim().toLowerCase(), l.id);

  const cleanedNames = Array.from(new Set(Object.values(LOCATION_NAME_MAP)));
  const result = new Map<string, string>(); // cleaned name -> location id
  for (const name of cleanedNames) {
    const key = name.toLowerCase();
    let id = byName.get(key);
    if (!id) {
      const loc = await storage.createLocation({ companyId, name });
      id = loc.id;
      byName.set(key, id);
    }
    result.set(name, id);
  }
  return result;
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
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });

  const companyId = await ensureCompany();
  const locationByName = await ensureLocations(companyId);

  // Build a lookup of existing employees by stored employee number so the run
  // is idempotent. Scope to THIS company (join users) so a matching employee
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
    if (p.employeeNumber) userIdByNumber.set(p.employeeNumber, p.userId);
  }

  let created = 0;
  let updated = 0;
  const skipped: { row: number; reason: string }[] = [];

  let rowNum = 1;
  for (const row of rows) {
    rowNum++;
    const employeeNumber = row.ID == null ? "" : String(row.ID).trim();
    const employeeCell = row.Employee == null ? "" : String(row.Employee).trim();
    const rawLocation = row.Location == null ? "" : String(row.Location).trim();

    if (!employeeNumber) {
      skipped.push({ row: rowNum, reason: "missing ID" });
      continue;
    }
    if (!employeeCell) {
      skipped.push({
        row: rowNum,
        reason: `missing name (ID ${employeeNumber})`,
      });
      continue;
    }

    const cleanedLocation = LOCATION_NAME_MAP[rawLocation];
    if (!cleanedLocation) {
      skipped.push({
        row: rowNum,
        reason: `unknown location "${rawLocation}" (ID ${employeeNumber})`,
      });
      continue;
    }
    const locationId = locationByName.get(cleanedLocation)!;
    const { firstName, lastName } = parseName(employeeCell);

    const existingUserId = userIdByNumber.get(employeeNumber);
    if (existingUserId) {
      // Idempotent update: refresh name/company/location, never duplicate.
      await storage.updateUser(existingUserId, {
        firstName,
        lastName,
        role: "employee",
        companyId,
      });
      await storage.setUserLocationIds(existingUserId, [locationId]);
      await storage.updateEmploymentProfile(existingUserId, { employeeNumber });
      updated++;
      continue;
    }

    const newUser = await storage.createUser({
      firstName,
      lastName,
      role: "employee",
      companyId,
    });
    await storage.setUserLocationIds(newUser.id, [locationId]);
    await storage.createEmploymentProfile({
      userId: newUser.id,
      employeeNumber,
    });
    userIdByNumber.set(employeeNumber, newUser.id);
    created++;
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
    skipped,
    profilesWithNumber,
  };
}
