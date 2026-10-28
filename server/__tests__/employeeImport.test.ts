/**
 * Employee importer (enriched Sumner import): verifies that a workbook with the
 * new columns (Employee Name, Clock #, Actual Location, Paying Company, Wage
 * Type) creates employees keyed on Clock # = employee number, assigns one real
 * work location, and sets paying company + wage type — leaving blank pay cells
 * at the default. Also covers idempotency and the legacy column fallback.
 *
 * Run with: `npx tsx server/__tests__/employeeImport.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { importEmployeesFromBuffer, COMPANY_NAME } from "../services/employeeImport";

const stamp = `imp-${Date.now().toString(36)}`;
// Unique clock #s so the run is isolated from any other data in the test DB.
const CK = {
  w2: `${stamp}-1`,
  k1099: `${stamp}-2`,
  bcmBlank: `${stamp}-3`,
  legacy: `${stamp}-4`,
  badpay: `${stamp}-5`,
};

function wbBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// A BCM paying-company record must already exist (the importer never creates
// payroll companies). Ensure one for the test.
const [bcm] = await db
  .insert(schema.companies)
  .values({ name: `BCM ${stamp}` })
  .returning();

async function profileFor(clock: string) {
  const [row] = await db
    .select({
      userId: schema.userEmploymentProfiles.userId,
      employeeNumber: schema.userEmploymentProfiles.employeeNumber,
      payrollCompanyId: schema.userEmploymentProfiles.payrollCompanyId,
      taxClassification: schema.userEmploymentProfiles.taxClassification,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
    })
    .from(schema.userEmploymentProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userEmploymentProfiles.userId))
    .where(eq(schema.userEmploymentProfiles.employeeNumber, clock));
  return row;
}

test("enriched import: clock # key, one location, paying company + wage type", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Aboody Sarah", "Clock #": CK.w2, "Actual Location": "Sumner", "Paying Company": "Ahava Medical", "Wage Type": "W-2" },
    { "Employee Name": "Aharoni Daniel zev", "Clock #": CK.k1099, "Actual Location": "Sumner", "Paying Company": "Ahava Medical", "Wage Type": "1099" },
    { "Employee Name": "Carrey Akiva", "Clock #": CK.bcmBlank, "Actual Location": "Sumner", "Paying Company": `BCM ${stamp}`, "Wage Type": "" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.ok(summary.created >= 3, "three new employees created");
  assert.equal(summary.company, COMPANY_NAME);

  const w2 = await profileFor(CK.w2);
  assert.ok(w2, "W-2 employee imported");
  assert.equal(w2!.firstName, "Aboody");
  assert.equal(w2!.lastName, "Sarah");
  assert.equal(w2!.taxClassification, "W-2");

  const k = await profileFor(CK.k1099);
  assert.equal(k!.taxClassification, "1099", "1099 wage type stored");

  const bcmRow = await profileFor(CK.bcmBlank);
  assert.equal(bcmRow!.payrollCompanyId, bcm.id, "paying company matched to the BCM record by name");
  assert.equal(bcmRow!.taxClassification, "W-2", "blank wage type stays at the schema default");

  // All three land at a single "Sumner" location under the operational company.
  const amc = (await db.select().from(schema.companies).where(eq(schema.companies.name, COMPANY_NAME)))[0];
  const sumners = await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.companyId, amc.id), eq(schema.locations.name, "Sumner")));
  assert.equal(sumners.length, 1, "exactly one Sumner location created");
});

test("idempotent: re-running updates in place, never duplicates", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Aboody Sarah RENAMED", "Clock #": CK.w2, "Actual Location": "Sumner", "Paying Company": "Ahava Medical", "Wage Type": "W-2" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.ok(summary.updated >= 1, "existing clock # updated, not created");

  const rows = await db
    .select()
    .from(schema.userEmploymentProfiles)
    .where(eq(schema.userEmploymentProfiles.employeeNumber, CK.w2));
  assert.equal(rows.length, 1, "still exactly one profile for that clock #");
  const w2 = await profileFor(CK.w2);
  assert.equal(w2!.lastName, "Sarah RENAMED", "name refreshed on re-import");
});

test("unrecognized paying company warns but still imports", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Ghost Payer", "Clock #": CK.badpay, "Actual Location": "Sumner", "Paying Company": "Nonexistent Co", "Wage Type": "W-2" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  const row = await profileFor(CK.badpay);
  assert.ok(row, "employee still imported despite bad paying company");
  assert.equal(row!.payrollCompanyId, null, "payroll company left blank when unmatched");
  assert.ok(summary.warnings.some((w) => /paying company/i.test(w.reason)), "a warning was recorded");
});

test("legacy columns still work (Employee / ID / Location)", async () => {
  const buf = wbBuffer([
    { Employee: "Legacy Person", ID: CK.legacy, Dept: "", Location: "Monsey" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.ok(summary.created + summary.updated >= 1);
  const row = await profileFor(CK.legacy);
  assert.ok(row, "legacy row imported by ID");
  assert.equal(row!.firstName, "Legacy");
});

test.after(async () => {
  // Clean up every user this test created, their profiles, and the BCM record.
  const clocks = Object.values(CK);
  const profs = await db
    .select({ userId: schema.userEmploymentProfiles.userId })
    .from(schema.userEmploymentProfiles)
    .where(inArray(schema.userEmploymentProfiles.employeeNumber, clocks));
  const userIds = profs.map((p) => p.userId);
  if (userIds.length) {
    await db.delete(schema.employeeLocations).where(inArray(schema.employeeLocations.userId, userIds)).catch(() => {});
    await db.delete(schema.userEmploymentProfiles).where(inArray(schema.userEmploymentProfiles.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
  await db.delete(schema.companies).where(eq(schema.companies.id, bcm.id)).catch(() => {});
});
