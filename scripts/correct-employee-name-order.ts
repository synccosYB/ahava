/** See docs/employee-name-order.md. Preview does not change the database. */
import fs from "node:fs";
import { pool } from "../server/db";
import { applyNameCorrection, planNameCorrection, type NameCorrectionPlan } from "../server/services/employeeNameCorrection";

const [mode, file, companyId, ...extra] = process.argv.slice(2);
async function main() {
  if (!file || extra.length || (mode !== "--preview" && mode !== "--apply") || (mode === "--preview" ? !companyId : !!companyId)) {
    throw new Error("Usage: tsx scripts/correct-employee-name-order.ts --preview plan.json COMPANY_ID | --apply plan.json");
  }
  const client = await pool.connect();
  try {
    if (mode === "--preview") {
      const plan = await planNameCorrection(client, companyId);
      fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      console.log(`Saved ${plan.entries.length} proposed corrections to ${file}. Review the names before applying. No database changes made.`);
    } else {
      const plan = JSON.parse(fs.readFileSync(file, "utf8")) as NameCorrectionPlan;
      console.log(`Corrected ${await applyNameCorrection(client, plan)} employee names.`);
    }
  } finally {
    client.release();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
