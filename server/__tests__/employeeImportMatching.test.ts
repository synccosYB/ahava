/**
 * Clock # matching is company-agnostic and reconciles with the fingerprint
 * device number. At Ahava a Clock # is one person's single identifier, so the
 * importer must find them even when:
 *   - they're filed under a DIFFERENT company record than "Ahava Medical Center",
 *   - their profile number field is blank but they're enrolled (and clocking in)
 *     on a device under that number,
 * and must refuse to guess when a number maps to more than one person.
 *
 * Run with: `npx tsx server/__tests__/employeeImportMatching.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import {
  companies, locations, users, userEmploymentProfiles,
  biometricDevices, biometricDeviceUsers,
} from "@shared/schema";
import { importEmployeesFromBuffer, COMPANY_NAME } from "../services/employeeImport";

const stamp = `mt-${Date.now().toString(36)}`;
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

test("Clock # matches across companies + via device number; ambiguous is skipped", async (t) => {
  const userIds: string[] = [];
  const deviceIds: string[] = [];
  const locIds: string[] = [];
  const coIds: string[] = [];

  const ahava = (await storage.getAllCompanies()).find((c) => c.name === COMPANY_NAME)
    ?? await storage.createCompany({ name: COMPANY_NAME });
  const other = await storage.createCompany({ name: `Other Co ${stamp}` });
  coIds.push(other.id);
  const loc = await storage.createLocation({ companyId: ahava.id, name: `Sumner ${stamp}` });
  locIds.push(loc.id);

  // A) Employee filed under a DIFFERENT company, matched by profile Clock #.
  const xNum = `${stamp}-x`;
  const xUser = await storage.createUser({ firstName: "Cross", lastName: "Company", role: "employee", companyId: other.id });
  userIds.push(xUser.id);
  await storage.createEmploymentProfile({ userId: xUser.id, employeeNumber: xNum, payType: "hourly", hourlyRate: 15, requireLunchBreak: false });

  // B) Employee with a BLANK profile number but enrolled on a device as devNum.
  const devNum = `${stamp}-d`;
  const dUser = await storage.createUser({ firstName: "Device", lastName: "Only", role: "employee", companyId: ahava.id });
  userIds.push(dUser.id);
  await storage.createEmploymentProfile({ userId: dUser.id, employeeNumber: null, payType: "hourly", hourlyRate: 15, requireLunchBreak: false });
  const [dev] = await db.insert(biometricDevices).values({ serialNumber: `SN-${stamp}`, name: `Clock ${stamp}` }).returning();
  deviceIds.push(dev.id);
  await db.insert(biometricDeviceUsers).values({ deviceId: dev.id, deviceUserId: devNum, userId: dUser.id });

  // C) Two people share a Clock # -> ambiguous.
  const dupNum = `${stamp}-dup`;
  const dup1 = await storage.createUser({ firstName: "Dup", lastName: "One", role: "employee", companyId: ahava.id });
  const dup2 = await storage.createUser({ firstName: "Dup", lastName: "Two", role: "employee", companyId: other.id });
  userIds.push(dup1.id, dup2.id);
  await storage.createEmploymentProfile({ userId: dup1.id, employeeNumber: dupNum, payType: "hourly", hourlyRate: 15, requireLunchBreak: false });
  await storage.createEmploymentProfile({ userId: dup2.id, employeeNumber: dupNum, payType: "hourly", hourlyRate: 15, requireLunchBreak: false });

  t.after(async () => {
    await db.delete(biometricDeviceUsers).where(inArray(biometricDeviceUsers.userId, userIds)).catch(() => {});
    await db.delete(biometricDevices).where(inArray(biometricDevices.id, deviceIds)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, userIds)).catch(() => {});
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
    await db.delete(locations).where(inArray(locations.id, locIds)).catch(() => {});
    await db.delete(companies).where(inArray(companies.id, coIds)).catch(() => {});
  });

  const buf = await buildSheet([
    { "Clock #": xNum, "First Name": "Cross", "Last Name": "Company", "Pay Setup": "Daily", "Pay Amount": 300 },
    { "Clock #": devNum, "First Name": "Device", "Last Name": "Only", "Pay Setup": "Daily", "Pay Amount": 280 },
    { "Clock #": dupNum, "First Name": "Dup", "Last Name": "One", "Pay Setup": "Daily", "Pay Amount": 250 },
  ]);

  // Preview: both the cross-company and device-number rows are found; dup is skipped.
  const preview = await importEmployeesFromBuffer(buf, { dryRun: true, updateOnly: true });
  assert.ok(preview.changes.some((c) => c.employeeNumber === xNum), "cross-company employee matched by Clock #");
  assert.ok(preview.changes.some((c) => c.employeeNumber === devNum), "device-number employee matched via fingerprint enrollment");
  assert.ok(
    preview.skipped.some((s) => s.reason.includes("more than one")),
    "shared Clock # is flagged ambiguous, not guessed",
  );
  assert.ok(!preview.skipped.some((s) => s.reason.includes("not found")), "no false 'not found' for the matched rows");

  // Apply: the two matches update; the device-number person gets their Clock #
  // written onto the profile (reconciling the two numbers).
  await importEmployeesFromBuffer(buf, { dryRun: false, updateOnly: true });
  assert.equal((await storage.getEmploymentProfile(xUser.id))?.payType, "daily", "cross-company employee updated");
  const dAfter = await storage.getEmploymentProfile(dUser.id);
  assert.equal(dAfter?.payType, "daily", "device-matched employee updated");
  assert.equal(dAfter?.employeeNumber, devNum, "Clock # written onto the profile that had none");
  // The ambiguous pair is untouched.
  assert.equal((await storage.getEmploymentProfile(dup1.id))?.payType, "hourly", "ambiguous #1 untouched");
  assert.equal((await storage.getEmploymentProfile(dup2.id))?.payType, "hourly", "ambiguous #2 untouched");
});
