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
import { locations, users, userEmploymentProfiles } from "@shared/schema";
import { buildEmployeeExport } from "../services/employeeExport";
import { importEmployeesFromBuffer } from "../services/employeeImport";

const stamp = `rt-${Date.now().toString(36)}`;
const createdUserIds: string[] = [];

// Edit a single employee's row (found by the hidden Employee ID) across the
// workbook's location tabs, then return the re-serialized buffer.
async function editRow(buf: Buffer, userId: string, edits: Record<string, string | number>, omitColumn?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  for (const ws of [...wb.worksheets]) {
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
        const retained = ws.getRow(r).values;
        ws.spliceRows(2, ws.rowCount - 1);
        ws.addRow(retained);
        const removedColumn = omitColumn ? headers.indexOf(omitColumn) : -1;
        if (removedColumn > 0) ws.spliceColumns(removedColumn, 1);
        for (const other of [...wb.worksheets]) {
          if (other.id !== ws.id) wb.removeWorksheet(other.id);
        }
        return Buffer.from(await wb.xlsx.writeBuffer());
      }
    }
  }
  throw new Error("row not found for user " + userId);
}

test("round trip: edits in the sheet update the matched employee", async (t) => {
  const co = await storage.getAllCompanies().then((cs) => cs.find((c) => c.name === "Ahava Medical Center")) ?? await storage.createCompany({ name: "Ahava Medical Center" });
  const loc = await storage.createLocation({ companyId: co.id, name: `Sumner ${stamp}` });
  const secondary = await storage.createLocation({ companyId: co.id, name: `Secondary ${stamp}` });
  const replacement = await storage.createLocation({ companyId: co.id, name: `Liberty, West ${stamp}` });
  const u = await storage.createUser({ firstName: "Round", lastName: `${stamp}`, role: "employee", companyId: co.id });
  createdUserIds.push(u.id);
  await storage.setUserLocationIds(u.id, [loc.id, secondary.id]);
  await storage.createEmploymentProfile({ userId: u.id, employeeNumber: `${stamp}-1`, payType: "hourly", hourlyRate: 15, dailySalary: 140, taxClassification: "W-2", requireLunchBreak: false });

  t.after(async () => {
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, createdUserIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
    await db.delete(locations).where(inArray(locations.id, [loc.id, secondary.id, replacement.id])).catch(() => {});
  });

  const buf1 = await buildEmployeeExport();
  await importEmployeesFromBuffer(await editRow(buf1, u.id, {}));
  assert.deepEqual(new Set(await storage.getUserLocationIds(u.id)), new Set([loc.id, secondary.id]));
  assert.equal((await storage.getEmploymentProfile(u.id))?.dailySalary, 140);

  // Export, then edit this person: switch to Daily $200, lunch Required, make
  // them a Manager, and set a termination date (deactivate).
  const buf2 = await editRow(buf1, u.id, {
    "Location": replacement.name,
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
  assert.equal(afterUser?.locationId, replacement.id, "the spreadsheet updates the primary location");
  assert.deepEqual(new Set(await storage.getUserLocationIds(u.id)), new Set([replacement.id, secondary.id]));
  assert.ok(afterUser?.deactivatedAt, "termination date deactivated the employee");
  assert.equal(afterProfile?.payType, "daily", "pay setup updated to daily");
  assert.equal(afterProfile?.dailySalary, 200, "daily salary set");
  assert.equal(afterProfile?.hourlyRate, null, "old hourly rate cleared");
  assert.equal(afterProfile?.requireLunchBreak, true, "lunch requirement updated");
  assert.equal(afterProfile?.terminationDate, "2026-11-01");
  assert.equal(afterUser?.terminationReason, null);

  // Now export the (deactivated) state, CLEAR the termination date, re-import ->
  // the person is reactivated.
  const buf3 = await buildEmployeeExport();
  await importEmployeesFromBuffer(await editRow(buf3, u.id, {}, "Termination Date"));
  assert.ok((await storage.getUser(u.id))?.deactivatedAt, "omitting the column does not reinstate the employee");
  const buf4 = await editRow(buf3, u.id, { "Termination Date": "" });
  const summary2 = await importEmployeesFromBuffer(buf4);
  assert.ok(summary2.reactivated.length >= 1, "a reactivation was recorded");
  const reUser = await storage.getUser(u.id);
  assert.equal(reUser?.deactivatedAt, null, "employee reactivated (deactivatedAt cleared)");
});
