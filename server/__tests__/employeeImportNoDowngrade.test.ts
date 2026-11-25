/**
 * Safety: an employee import must NEVER lower someone's access level. A stale
 * sheet that lists "Employee" for a Manager/Admin must keep the higher role and
 * record that the downgrade was blocked — this is what caused the "roles reset
 * to Employee" incident. Upgrades and same-level changes still apply.
 *
 * Run with: `npx tsx server/__tests__/employeeImportNoDowngrade.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import { users, userEmploymentProfiles } from "@shared/schema";
import { importEmployeesFromBuffer, COMPANY_NAME } from "../services/employeeImport";

const stamp = `nodg-${Date.now().toString(36)}`;
const HEADERS = ["Clock #", "Last Name", "First Name", "Access Level", "Role", "Pay Setup", "Pay Amount"];

async function buildSheet(rows: Record<string, string | number | null>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(HEADERS.map((h) => r[h] ?? null));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("import never downgrades a role, but still upgrades", async (t) => {
  const co = (await storage.getAllCompanies()).find((c) => c.name === COMPANY_NAME)
    ?? await storage.createCompany({ name: COMPANY_NAME });
  const clockNum = `${stamp}-mgr`;
  const u = await storage.createUser({ firstName: "Mendel", lastName: stamp, role: "manager", companyId: co.id });
  await storage.createEmploymentProfile({ userId: u.id, employeeNumber: clockNum, payType: "hourly", hourlyRate: 20 });

  t.after(async () => {
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, [u.id])).catch(() => {});
    await db.delete(users).where(inArray(users.id, [u.id])).catch(() => {});
  });

  // 1) A sheet that would DOWNGRADE the manager to Employee — must be blocked.
  const downgradeSheet = await buildSheet([
    { "Clock #": clockNum, "First Name": "Mendel", "Last Name": stamp, "Role": "Employee" },
  ]);
  const applied = await importEmployeesFromBuffer(downgradeSheet, { dryRun: false, updateOnly: true });

  const afterDowngrade = await storage.getUser(u.id);
  assert.equal(afterDowngrade?.role, "manager", "the manager was NOT downgraded to employee");
  assert.ok(
    applied.warnings.some((w) => /downgrade/i.test(w.reason)),
    `a downgrade-blocked note is recorded: ${applied.warnings.map((w) => w.reason).join(" | ")}`,
  );
  const changeRow = applied.changes.find((c) => c.employeeNumber === clockNum);
  assert.ok(changeRow, "the row appears in the change log");
  assert.ok(!changeRow!.actions.some((a) => /base role → employee/.test(a)), "no base-role change was applied");

  // 2) A sheet that UPGRADES the manager to Admin — must apply.
  const upgradeSheet = await buildSheet([
    { "Clock #": clockNum, "First Name": "Mendel", "Last Name": stamp, "Role": "Admin" },
  ]);
  await importEmployeesFromBuffer(upgradeSheet, { dryRun: false, updateOnly: true });
  const afterUpgrade = await storage.getUser(u.id);
  assert.equal(afterUpgrade?.role, "admin", "an upgrade (manager → admin) still applies");
});
