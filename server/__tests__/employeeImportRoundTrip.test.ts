/**
 * Employee export → edit → import ROUND TRIP. Exports the real workbook, edits a
 * row the way an admin would in Excel/Google Sheets, re-imports it, and asserts
 * the edits landed on the right person (matched by the hidden Employee ID key).
 *
 * Run with: `npx tsx server/__tests__/employeeImportRoundTrip.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import { users, userEmploymentProfiles } from "@shared/schema";
import { buildEmployeeExport } from "../services/employeeExport";
import { importEmployeesFromBuffer } from "../services/employeeImport";

const stamp = `rt-${Date.now().toString(36)}`;
const createdUserIds: string[] = [];

// Edit a single employee's row (found by the hidden Employee ID) across the
// workbook's location tabs, then return the re-serialized buffer.
async function editRow(buf: Buffer, userId: string, edits: Record<string, string | number>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  for (const ws of wb.worksheets) {
    if (ws.name === "Lists") continue;
    const headers = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
    const idCol = headers.indexOf("Employee ID");
    if (idCol < 1) continue;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getCell(r, idCol).value ?? "") === userId) {
        for (const [header, val] of Object.entries(edits)) {
          const c = headers.indexOf(header);
          if (c > 0) ws.getCell(r, c).value = val;
        }
        const out = await wb.xlsx.writeBuffer();
        return Buffer.from(out);
      }
    }
  }
  throw new Error("row not found for user " + userId);
}

test("round trip: edits in the sheet update the matched employee", async (t) => {
  const co = await storage.getAllCompanies().then((cs) => cs.find((c) => c.name === "Ahava Medical Center")) ?? await storage.createCompany({ name: "Ahava Medical Center" });
  const loc = await storage.createLocation({ companyId: co.id, name: `Sumner ${stamp}` });
  const u = await storage.createUser({ firstName: "Round", lastName: `${stamp}`, role: "employee", companyId: co.id });
  createdUserIds.push(u.id);
  await storage.setUserLocationIds(u.id, [loc.id]);
  await storage.createEmploymentProfile({ userId: u.id, employeeNumber: `${stamp}-1`, payType: "hourly", hourlyRate: 15, taxClassification: "W-2", requireLunchBreak: false });

  t.after(async () => {
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, createdUserIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
  });

  // Export, then edit this person: switch to Daily $200, lunch Required, make
  // them a Manager, and set a termination date (deactivate).
  const buf1 = await buildEmployeeExport();
  const buf2 = await editRow(buf1, u.id, {
    "Pay Setup": "Daily",
    "Pay Amount": 200,
    "Lunch Break": "Required",
    "Role": "Manager",
    "Termination Date": "2026-11-01",
  });
  const summary = await importEmployeesFromBuffer(buf2);
  assert.ok(summary.updated >= 1, "at least one row updated");

  const afterUser = await storage.getUser(u.id);
  const afterProfile = await storage.getEmploymentProfile(u.id);
  assert.equal(afterUser?.role, "manager", "base role updated to manager");
  assert.ok(afterUser?.deactivatedAt, "termination date deactivated the employee");
  assert.equal(afterProfile?.payType, "daily", "pay setup updated to daily");
  assert.equal(afterProfile?.dailySalary, 200, "daily salary set");
  assert.equal(afterProfile?.hourlyRate, null, "old hourly rate cleared");
  assert.equal(afterProfile?.requireLunchBreak, true, "lunch requirement updated");

  // Now export the (deactivated) state, CLEAR the termination date, re-import ->
  // the person is reactivated.
  const buf3 = await buildEmployeeExport();
  const buf4 = await editRow(buf3, u.id, { "Termination Date": "" });
  const summary2 = await importEmployeesFromBuffer(buf4);
  assert.ok(summary2.reactivated.length >= 1, "a reactivation was recorded");
  const reUser = await storage.getUser(u.id);
  assert.equal(reUser?.deactivatedAt, null, "employee reactivated (deactivatedAt cleared)");
});
