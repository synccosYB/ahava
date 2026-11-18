/**
 * Dry-run preview + update-only matching for the CLIENT-filled roster sheet.
 *
 * The client worked from a copy that has the human-readable columns (Clock #,
 * Access Level, …) but NOT the hidden "Employee ID" key. This proves:
 *   - rows match existing employees by Clock # (no Employee ID needed),
 *   - a dry run reports every change WITHOUT touching the database,
 *   - update-only skips (and flags) a Clock # that matches nobody instead of
 *     creating a new person,
 *   - a real (non-dry) run then applies exactly what the preview promised.
 *
 * Run with: `npx tsx server/__tests__/employeeImportDryRun.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import { locations, users, userEmploymentProfiles } from "@shared/schema";
import { importEmployeesFromBuffer, COMPANY_NAME } from "../services/employeeImport";

const stamp = `dry-${Date.now().toString(36)}`;

// Headers exactly as they appear on the client's sheet (no "Employee ID").
const HEADERS = [
  "Clock #", "Last Name", "First Name", "Access Level", "Role", "Department",
  "Location", "Working Company", "Paying Company", "Payroll Company",
  "Tax Classification", "Pay Setup", "Pay Amount", "Policies", "Lunch Break",
  "Termination Date",
];

async function buildSheet(rows: Record<string, string | number | null>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(HEADERS.map((h) => r[h] ?? null));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("dry-run preview + update-only Clock# matching", async (t) => {
  const createdUserIds: string[] = [];
  const co = (await storage.getAllCompanies()).find((c) => c.name === COMPANY_NAME)
    ?? await storage.createCompany({ name: COMPANY_NAME });
  const loc = await storage.createLocation({ companyId: co.id, name: `Sumner ${stamp}` });
  const clockNum = `${stamp}-match`;

  const u = await storage.createUser({ firstName: "Pre", lastName: stamp, role: "employee", companyId: co.id });
  createdUserIds.push(u.id);
  await storage.setUserLocationIds(u.id, [loc.id]);
  await storage.createEmploymentProfile({
    userId: u.id, employeeNumber: clockNum, payType: "hourly", hourlyRate: 15,
    taxClassification: "W-2", requireLunchBreak: false,
  });

  t.after(async () => {
    // update-only never creates anyone, so only our seeded user needs cleanup.
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, createdUserIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
    await db.delete(locations).where(inArray(locations.id, [loc.id])).catch(() => {});
  });

  // One row matches our employee (switch to Daily $375 + lunch Required); one row
  // is an unknown Clock # that must NOT create anyone in update-only mode.
  const unmatched = `${stamp}-ghost`;
  const buf = await buildSheet([
    { "Clock #": clockNum, "First Name": "Pre", "Last Name": stamp, "Role": "Employee",
      "Pay Setup": "Daily", "Pay Amount": 375, "Lunch Break": "Required" },
    { "Clock #": unmatched, "First Name": "Ghost", "Last Name": "Nobody",
      "Pay Setup": "Hourly", "Pay Amount": 20 },
  ]);

  // ---- DRY RUN: nothing may change ----
  const preview = await importEmployeesFromBuffer(buf, { dryRun: true, updateOnly: true });
  assert.equal(preview.dryRun, true, "summary marked as a dry run");
  assert.ok(preview.changes.length >= 1, "preview lists the matched row's changes");
  const mine = preview.changes.find((c) => c.employeeNumber === clockNum);
  assert.ok(mine, "matched employee appears in the change set");
  assert.ok(mine!.actions.some((a) => /pay →/.test(a)), `pay change described: ${mine!.actions.join("; ")}`);
  assert.ok(mine!.actions.some((a) => /lunch → required/.test(a)), "lunch change described");
  assert.ok(preview.skipped.some((s) => s.reason.includes("not found")), "unmatched Clock # is skipped & flagged");
  assert.equal(preview.created, 0, "dry run creates nobody");

  // The database must be untouched by the preview.
  const afterPreview = await storage.getEmploymentProfile(u.id);
  assert.equal(afterPreview?.payType, "hourly", "preview did NOT change pay type");
  assert.equal(Number(afterPreview?.hourlyRate), 15, "preview did NOT change the rate");
  assert.equal(afterPreview?.requireLunchBreak, false, "preview did NOT change lunch");

  // ---- REAL RUN: applies exactly what the preview promised ----
  const applied = await importEmployeesFromBuffer(buf, { dryRun: false, updateOnly: true });
  assert.equal(applied.dryRun, false, "real run not marked dry");
  assert.ok(applied.updated >= 1, "the matched employee was updated");
  assert.equal(applied.created, 0, "update-only created nobody for the ghost Clock #");
  assert.ok(applied.skipped.some((s) => s.reason.includes("not found")), "ghost still skipped on the real run");

  const afterReal = await storage.getEmploymentProfile(u.id);
  assert.equal(afterReal?.payType, "daily", "real run switched pay to daily");
  assert.equal(Number(afterReal?.dailySalary), 375, "daily salary applied");
  assert.equal(afterReal?.hourlyRate, null, "old hourly rate cleared");
  assert.equal(afterReal?.requireLunchBreak, true, "lunch requirement applied");
});
