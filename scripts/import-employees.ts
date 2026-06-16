/**
 * One-time CLI import of the employees from the uploaded spreadsheet
 * (attached_assets/employee_list_1781613566094.xlsx).
 *
 * The actual import logic lives in server/services/employeeImport.ts so it can
 * be shared with the admin "Import Employees" upload endpoint. This wrapper just
 * reads the bundled spreadsheet off disk and prints the summary.
 *
 * Run with:  npx tsx scripts/import-employees.ts
 */
import fs from "fs";
import path from "path";
import { importEmployeesFromBuffer } from "../server/services/employeeImport";

const SPREADSHEET = path.resolve(
  "attached_assets/employee_list_1781613566094.xlsx",
);

async function main() {
  console.log("Reading spreadsheet:", SPREADSHEET);
  const buffer = fs.readFileSync(SPREADSHEET);
  const summary = await importEmployeesFromBuffer(buffer);

  console.log("\n===== Import Summary =====");
  console.log(`Company:            ${summary.company} (${summary.companyId})`);
  console.log(`Rows parsed:        ${summary.rowsParsed}`);
  console.log(`Locations (company): ${summary.locationsTotal}`);
  console.log(`Employees created:  ${summary.created}`);
  console.log(`Employees updated:  ${summary.updated}`);
  console.log(`Rows skipped:       ${summary.skipped.length}`);
  console.log(`Profiles w/ number: ${summary.profilesWithNumber}`);
  if (summary.skipped.length) {
    console.log("\nSkipped rows:");
    for (const s of summary.skipped) console.log(`  row ${s.row}: ${s.reason}`);
  }
  console.log("==========================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
