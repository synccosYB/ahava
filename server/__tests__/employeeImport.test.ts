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
  dept: `${stamp}-6`,
  deptUnknown: `${stamp}-7`,
  inactive: `${stamp}-8`,
  roleOk: `${stamp}-9`,
  roleSystem: `${stamp}-10`,
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

// A department the importer can match a "Department" cell to (global list,
// name globally unique — so stamp it). The importer never creates departments.
const DEPT_NAME = `Oncology ${stamp}`;
const [dept] = await db
  .insert(schema.departments)
  .values({ name: DEPT_NAME })
  .returning();

// A custom (non-system) role the importer may assign, plus a system role it
// must refuse to assign from a spreadsheet.
const NURSE_ROLE = `Nurse ${stamp}`;
const SYSTEM_ROLE = `Admin ${stamp}`;
const [nurseRole] = await db
  .insert(schema.roles)
  .values({ name: NURSE_ROLE, isSystem: false })
  .returning();
const [systemRole] = await db
  .insert(schema.roles)
  .values({ name: SYSTEM_ROLE, isSystem: true })
  .returning();

async function deptIdsFor(clock: string): Promise<string[]> {
  const prof = await profileFor(clock);
  if (!prof) return [];
  const rows = await db
    .select({ departmentId: schema.employeeDepartments.departmentId })
    .from(schema.employeeDepartments)
    .where(eq(schema.employeeDepartments.userId, prof.userId));
  return rows.map((r) => r.departmentId);
}

async function userFor(clock: string) {
  const prof = await profileFor(clock);
  if (!prof) return undefined;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, prof.userId));
  return u;
}

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
  assert.equal(w2!.firstName, "Sarah");
  assert.equal(w2!.lastName, "Aboody");
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
  assert.equal(w2!.firstName, "Sarah RENAMED", "given names refreshed on re-import");
  assert.equal(w2!.lastName, "Aboody", "surname stays in the last-name field");
});

test("separate name columns preserve compound names and override a combined name", async () => {
  const summary = await importEmployeesFromBuffer(wbBuffer([
    { "First Name": "Sarah Jane", "Last Name": "de Aboody", "Employee Name": "Do not parse this", "Clock #": CK.w2, "Actual Location": "Sumner" },
  ]));
  assert.ok(summary.updated >= 1);
  const row = await profileFor(CK.w2);
  assert.equal(row!.firstName, "Sarah Jane");
  assert.equal(row!.lastName, "de Aboody");
  // A combined cell is not required when separate columns are present.
  await importEmployeesFromBuffer(wbBuffer([
    { "First Name": "Sarah", "Last Name": "Aboody", "Clock #": CK.w2, "Actual Location": "Sumner" },
  ]));
  assert.equal((await profileFor(CK.w2))!.firstName, "Sarah");
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
  assert.equal(row!.firstName, "Person");
  assert.equal(row!.lastName, "Legacy");
});

test("Department cell assigns a matching (existing) department", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Dept Match", "Clock #": CK.dept, "Actual Location": "Sumner", "Department": DEPT_NAME, "Wage Type": "W-2" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.ok(summary.departmentsAssigned >= 1, "a department was assigned");
  assert.deepEqual(await deptIdsFor(CK.dept), [dept.id], "employee linked to the matched department");
});

test("unknown Department warns and leaves the employee unassigned", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Dept Typo", "Clock #": CK.deptUnknown, "Actual Location": "Sumner", "Department": "Nuero", "Wage Type": "W-2" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.deepEqual(await deptIdsFor(CK.deptUnknown), [], "no department assigned for an unknown name");
  assert.ok(summary.warnings.some((w) => /unknown department "Nuero"/i.test(w.reason)), "unknown department warned");
});

test('Department "Inactive" deactivates the employee (and assigns no department)', async () => {
  const buf = wbBuffer([
    { "Employee Name": "Gone Away", "Clock #": CK.inactive, "Actual Location": "Sumner", "Department": "Inactive", "Wage Type": "W-2" },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  const u = await userFor(CK.inactive);
  assert.ok(u, "employee still imported");
  assert.ok(u!.deactivatedAt, "employee deactivated");
  assert.deepEqual(await deptIdsFor(CK.inactive), [], '"Inactive" is not treated as a department');
  assert.ok(summary.deactivated.some((d) => d.employeeNumber === CK.inactive), "reported in the deactivated list");
});

test("re-importing an Inactive row preserves a human-set termination reason", async () => {
  // Simulate an admin later choosing a reason in the UI.
  const u = await userFor(CK.inactive);
  await db.update(schema.users).set({ terminationReason: "Fired" }).where(eq(schema.users.id, u!.id));
  const buf = wbBuffer([
    { "Employee Name": "Gone Away", "Clock #": CK.inactive, "Actual Location": "Sumner", "Department": "Inactive", "Wage Type": "W-2" },
  ]);
  await importEmployeesFromBuffer(buf);
  const again = await userFor(CK.inactive);
  assert.equal(again!.terminationReason, "Fired", "already-deactivated employee not touched; reason kept");
});

test("Role cell assigns a matching non-system role; system roles are refused", async () => {
  const buf = wbBuffer([
    { "Employee Name": "Has Role", "Clock #": CK.roleOk, "Actual Location": "Sumner", "Department": DEPT_NAME, "Role": NURSE_ROLE },
    { "Employee Name": "No Admin", "Clock #": CK.roleSystem, "Actual Location": "Sumner", "Department": DEPT_NAME, "Role": SYSTEM_ROLE },
  ]);
  const summary = await importEmployeesFromBuffer(buf);
  assert.ok(summary.rolesAssigned >= 1, "at least one role assigned");

  const okProf = await profileFor(CK.roleOk);
  const okRoles = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, okProf!.userId));
  assert.ok(okRoles.some((r) => r.roleId === nurseRole.id), "non-system role assigned");

  const sysProf = await profileFor(CK.roleSystem);
  const sysRoles = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, sysProf!.userId));
  assert.equal(sysRoles.length, 0, "a system role is never assigned from the sheet");
  assert.ok(summary.warnings.some((w) => w.reason.includes(SYSTEM_ROLE)), "system role name warned as unknown");
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
    await db.delete(schema.employeeDepartments).where(inArray(schema.employeeDepartments.userId, userIds)).catch(() => {});
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, userIds)).catch(() => {});
    await db.delete(schema.userEmploymentProfiles).where(inArray(schema.userEmploymentProfiles.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
  await db.delete(schema.departments).where(eq(schema.departments.id, dept.id)).catch(() => {});
  await db.delete(schema.roles).where(inArray(schema.roles.id, [nurseRole.id, systemRole.id])).catch(() => {});
  await db.delete(schema.companies).where(eq(schema.companies.id, bcm.id)).catch(() => {});
});
