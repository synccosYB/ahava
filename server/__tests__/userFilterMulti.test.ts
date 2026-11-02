/**
 * Multi-select employee filters: getUsersPage with departmentIds / locationIds
 * matches an employee in ANY of the given departments or locations (OR), which
 * is what the new multi-select + Apply filter on the Employees page sends.
 *
 * Run with: `npx tsx server/__tests__/userFilterMulti.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";

const stamp = `uf-${Date.now().toString(36)}`;
const [co] = await db.insert(schema.companies).values({ name: `Co ${stamp}` }).returning();
const [vision] = await db.insert(schema.departments).values({ name: `Vision ${stamp}`, companyId: co.id }).returning();
const [onco] = await db.insert(schema.departments).values({ name: `Oncology ${stamp}`, companyId: co.id }).returning();
const [other] = await db.insert(schema.departments).values({ name: `Other ${stamp}`, companyId: co.id }).returning();
const [locA] = await db.insert(schema.locations).values({ name: `LocA ${stamp}`, companyId: co.id }).returning();
const [locB] = await db.insert(schema.locations).values({ name: `LocB ${stamp}`, companyId: co.id }).returning();

async function mkUser(tag: string, deptId: string, locId: string) {
  const [u] = await db.insert(schema.users).values({
    id: `${stamp}-${tag}`, email: `${stamp}-${tag}@test.local`, firstName: tag, lastName: stamp, role: "employee", companyId: co.id,
  }).returning();
  await db.insert(schema.employeeDepartments).values({ userId: u.id, departmentId: deptId });
  await db.insert(schema.employeeLocations).values({ userId: u.id, locationId: locId });
  return u;
}
const uVision = await mkUser("vis", vision.id, locA.id);
const uOnco = await mkUser("onc", onco.id, locB.id);
const uOther = await mkUser("oth", other.id, locA.id);
const mine = new Set([uVision.id, uOnco.id, uOther.id]);

test("departmentIds matches ANY of the selected departments (Vision OR Oncology)", async () => {
  const { rows } = await storage.getUsersPage({ departmentIds: [vision.id, onco.id], limit: 100, offset: 0 });
  const got = rows.filter((r) => mine.has(r.id)).map((r) => r.id).sort();
  assert.deepEqual(got, [uVision.id, uOnco.id].sort(), "returns Vision + Oncology, not Other");
});

test("single department still works via departmentIds of one", async () => {
  const { rows } = await storage.getUsersPage({ departmentIds: [onco.id], limit: 100, offset: 0 });
  const got = rows.filter((r) => mine.has(r.id)).map((r) => r.id);
  assert.deepEqual(got, [uOnco.id]);
});

test("locationIds matches ANY of the selected locations", async () => {
  const { rows } = await storage.getUsersPage({ locationIds: [locA.id, locB.id], limit: 100, offset: 0 });
  const got = rows.filter((r) => mine.has(r.id)).map((r) => r.id).sort();
  assert.deepEqual(got, [uVision.id, uOnco.id, uOther.id].sort(), "all three (both locations)");
  const justB = await storage.getUsersPage({ locationIds: [locB.id], limit: 100, offset: 0 });
  assert.deepEqual(justB.rows.filter((r) => mine.has(r.id)).map((r) => r.id), [uOnco.id]);
});

test("department + location combine (AND across filter types, OR within each)", async () => {
  // Vision OR Oncology, AND in LocA  => only the Vision user (Oncology is LocB).
  const { rows } = await storage.getUsersPage({ departmentIds: [vision.id, onco.id], locationIds: [locA.id], limit: 100, offset: 0 });
  assert.deepEqual(rows.filter((r) => mine.has(r.id)).map((r) => r.id), [uVision.id]);
});

test.after(async () => {
  const ids = [uVision.id, uOnco.id, uOther.id];
  await db.delete(schema.employeeDepartments).where(inArray(schema.employeeDepartments.userId, ids)).catch(() => {});
  await db.delete(schema.employeeLocations).where(inArray(schema.employeeLocations.userId, ids)).catch(() => {});
  await db.delete(schema.users).where(inArray(schema.users.id, ids)).catch(() => {});
  await db.delete(schema.departments).where(inArray(schema.departments.id, [vision.id, onco.id, other.id])).catch(() => {});
  await db.delete(schema.locations).where(inArray(schema.locations.id, [locA.id, locB.id])).catch(() => {});
  await db.delete(schema.companies).where(eq(schema.companies.id, co.id)).catch(() => {});
});
