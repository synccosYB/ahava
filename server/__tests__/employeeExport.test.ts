/**
 * Employee export workbook: one tab per location, all columns, real dropdowns,
 * and a hidden Employee ID key column so a re-import matches each row exactly.
 *
 * Run with: `npx tsx server/__tests__/employeeExport.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import { users, userEmploymentProfiles } from "@shared/schema";
import { buildEmployeeExport } from "../services/employeeExport";

const stamp = `expt-${Date.now().toString(36)}`;
const createdUserIds: string[] = [];

test("export: per-location tabs, columns, dropdowns, hidden key", async (t) => {
  const co = await storage.createCompany({ name: `Ahava Medical Center ${stamp}` });
  const locA = await storage.createLocation({ companyId: co.id, name: `Sumner ${stamp}` });
  const locB = await storage.createLocation({ companyId: co.id, name: `Monsey ${stamp}` });

  const mk = async (first: string, last: string, locId: string, num: string) => {
    const u = await storage.createUser({ firstName: first, lastName: last, role: "employee", companyId: co.id });
    createdUserIds.push(u.id);
    await storage.setUserLocationIds(u.id, [locId]);
    await storage.createEmploymentProfile({ userId: u.id, employeeNumber: num, payType: "hourly", hourlyRate: 18, taxClassification: "W-2", requireLunchBreak: true });
    return u;
  };
  const a = await mk("Aaron", `${stamp}A`, locA.id, `${stamp}-1`);
  await mk("Bina", `${stamp}B`, locB.id, `${stamp}-2`);

  t.after(async () => {
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, createdUserIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
  });

  const buf = await buildEmployeeExport();
  assert.ok(buf.length > 0, "workbook has bytes");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const names = wb.worksheets.map((w) => w.name);
  // A hidden "Lists" sheet backs the dropdowns, plus a tab per seeded location.
  assert.ok(names.includes("Lists"), "has hidden Lists sheet");
  assert.ok(wb.getWorksheet("Lists")?.state !== "visible", "Lists sheet is hidden");
  const sumnerTab = wb.worksheets.find((w) => w.name.startsWith(`Sumner ${stamp}`.slice(0, 20)) || w.name.includes(stamp.slice(0, 6)));
  assert.ok(wb.worksheets.length >= 3, "at least Lists + two location tabs");

  // Find Aaron's tab and row.
  const tab = wb.worksheets.find((w) => w.name !== "Lists" && w.getColumn(3).values.some((v) => String(v).includes(`${stamp}A`)));
  assert.ok(tab, "found the tab containing Aaron");

  // Header row carries the expected columns (stable strings the importer reads).
  const headers = (tab!.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
  for (const h of ["Employee ID", "Clock #", "Last Name", "First Name", "Role", "Tax Classification", "Pay Setup", "Pay Amount", "Lunch Break", "Termination Date"]) {
    assert.ok(headers.includes(h), `header has "${h}"`);
  }

  // The Employee ID (key) column is hidden but populated with the real user id.
  const idCol = tab!.getColumn(1);
  assert.equal(idCol.hidden, true, "Employee ID column is hidden");
  const idValues = (idCol.values as unknown[]).map((v) => String(v ?? ""));
  assert.ok(idValues.includes(a.id), "hidden key column carries the user id");

  // A dropdown (list data validation) is attached to the Tax Classification cell.
  const taxIdx = headers.indexOf("Tax Classification");
  assert.ok(taxIdx > 0, "tax column located");
  const taxColLetter = tab!.getColumn(taxIdx).letter;
  const dv = tab!.getCell(`${taxColLetter}2`).dataValidation;
  assert.equal(dv?.type, "list", "tax cell has a list dropdown");
});
