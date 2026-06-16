/**
 * Task #427: one-time import of the 231 employees from the uploaded spreadsheet
 * (attached_assets/employee_list_1781613566094.xlsx).
 *
 * For each row it:
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
 *
 * Run with:  npx tsx scripts/import-employees.ts
 */
import path from "path";
import XLSX from "xlsx";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { userEmploymentProfiles } from "../shared/schema";

const SPREADSHEET = path.resolve(
  "attached_assets/employee_list_1781613566094.xlsx",
);
const COMPANY_NAME = "Ahava Medical Center";

// Raw location string in the file -> approved cleaned name.
const LOCATION_NAME_MAP: Record<string, string> = {
  "Sumner ahava": "Sumner Ahava",
  "Sumner Ahava Other": "Sumner Ahava Other",
  "Ahava Liberty": "Ahava Liberty",
  "Sumner bcm": "Sumner BCM",
  "Inwwod": "Inwood",
  "bcm other": "BCM Other",
  "Monsey": "Monsey",
};

interface Row {
  Employee: string;
  ID: string | number;
  Dept: string | number;
  Location: string;
}

/**
 * First word of the cell is the first name, the remaining word(s) are the last
 * name (per the task spec). A handful of rows use a "Last, First" comma form
 * (e.g. "Aricapa, Jorge"); we strip the stray comma so the stored name has no
 * punctuation, but still treat the first token as the first name.
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
  console.log(`Created company "${COMPANY_NAME}" (${created.id})`);
  return created.id;
}

async function ensureLocations(
  companyId: string,
): Promise<Map<string, string>> {
  const existing = await storage.getAllLocations();
  const byName = new Map<string, string>();
  for (const l of existing) byName.set(l.name.trim().toLowerCase(), l.id);

  const cleanedNames = Array.from(new Set(Object.values(LOCATION_NAME_MAP)));
  const result = new Map<string, string>(); // cleaned name -> location id
  let created = 0;
  for (const name of cleanedNames) {
    const key = name.toLowerCase();
    let id = byName.get(key);
    if (!id) {
      const loc = await storage.createLocation({ companyId, name });
      id = loc.id;
      byName.set(key, id);
      created++;
      console.log(`Created location "${name}" (${id})`);
    }
    result.set(name, id);
  }
  console.log(`Locations: ${created} created, ${cleanedNames.length - created} reused`);
  return result;
}

async function main() {
  console.log("Reading spreadsheet:", SPREADSHEET);
  const wb = XLSX.readFile(SPREADSHEET);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
  console.log(`Parsed ${rows.length} rows`);

  const companyId = await ensureCompany();
  const locationByName = await ensureLocations(companyId);

  // Build a lookup of existing employees by stored employee number so the run
  // is idempotent.
  const existingProfiles = await db
    .select({
      userId: userEmploymentProfiles.userId,
      employeeNumber: userEmploymentProfiles.employeeNumber,
    })
    .from(userEmploymentProfiles);
  const userIdByNumber = new Map<string, string>();
  for (const p of existingProfiles) {
    if (p.employeeNumber) userIdByNumber.set(p.employeeNumber, p.userId);
  }

  let createdCount = 0;
  let updatedCount = 0;
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
      skipped.push({ row: rowNum, reason: `missing name (ID ${employeeNumber})` });
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
      updatedCount++;
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
    createdCount++;
  }

  // Verification summary.
  const companyLocations = await storage.getLocationsByCompany(companyId);
  const profilesWithNumber = (
    await db
      .select({ employeeNumber: userEmploymentProfiles.employeeNumber })
      .from(userEmploymentProfiles)
  ).filter((p) => p.employeeNumber).length;

  console.log("\n===== Import Summary =====");
  console.log(`Company:            ${COMPANY_NAME} (${companyId})`);
  console.log(`Locations (company): ${companyLocations.length}`);
  console.log(`Employees created:  ${createdCount}`);
  console.log(`Employees updated:  ${updatedCount}`);
  console.log(`Rows skipped:       ${skipped.length}`);
  console.log(`Profiles w/ number: ${profilesWithNumber}`);
  if (skipped.length) {
    console.log("\nSkipped rows:");
    for (const s of skipped) console.log(`  row ${s.row}: ${s.reason}`);
  }
  console.log("==========================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
