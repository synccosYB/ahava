/**
 * Note #3 — multi-hat manager visibility + department↔location mapping.
 *
 * Verifies storage.getManagerScopedUserIds resolves a manager's hats as the
 * UNION of (location?, department?) scopes, reproducing the owner's example:
 * "Location Manager @ Sumner AND Vision Manager @ Kingston" sees everyone at
 * Sumner PLUS Vision-at-Kingston — but not non-Vision people at Kingston.
 *
 * Run with: `npx tsx server/__tests__/managerScopes.test.ts` (requires DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";

const stamp = `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const ids: string[] = [];

async function makeCompany(name: string): Promise<string> {
  const [c] = await db.insert(schema.companies).values({ name: `${name}-${stamp}` }).returning();
  return c.id;
}
async function makeLocation(companyId: string, name: string): Promise<string> {
  const [l] = await db.insert(schema.locations).values({ companyId, name: `${name}-${stamp}` }).returning();
  return l.id;
}
async function makeDept(name: string): Promise<string> {
  const [d] = await db.insert(schema.departments).values({ name: `${name}-${stamp}` }).returning();
  return d.id;
}
async function makeEmployee(companyId: string, locId: string, deptId: string, tag: string): Promise<string> {
  const id = `${stamp}-${tag}`;
  await db.insert(schema.users).values({ id, email: `${id}@test.local`, firstName: tag, lastName: "T", role: "employee", companyId });
  await storage.setUserLocationIds(id, [locId]);
  await storage.setUserDepartmentIds(id, [deptId]);
  ids.push(id);
  return id;
}

const companyId = await makeCompany("AhavaMed");
const sumner = await makeLocation(companyId, "Sumner");
const kingston = await makeLocation(companyId, "Kingston");
const vision = await makeDept("Vision");
const peds = await makeDept("Pediatrics");

// Four employees across the location × department matrix.
const sumnerVision = await makeEmployee(companyId, sumner, vision, "A");
const sumnerPeds = await makeEmployee(companyId, sumner, peds, "B");
const kingstonVision = await makeEmployee(companyId, kingston, vision, "C");
const kingstonPeds = await makeEmployee(companyId, kingston, peds, "D");

// The manager wearing two hats.
const mgrId = `${stamp}-M`;
await db.insert(schema.users).values({ id: mgrId, email: `${mgrId}@test.local`, firstName: "Mgr", lastName: "T", role: "manager", companyId });
ids.push(mgrId);

test("no hats → null (legacy fallback)", async () => {
  const scoped = await storage.getManagerScopedUserIds(mgrId);
  assert.equal(scoped, null, "a manager with no hats must fall back to legacy scoping");
});

test("hats union: all-of-Sumner + Vision-at-Kingston", async () => {
  await storage.setManagerScopes(mgrId, [
    { locationId: sumner, departmentId: null }, // everyone at Sumner
    { locationId: kingston, departmentId: vision }, // Vision at Kingston only
  ]);
  const scoped = await storage.getManagerScopedUserIds(mgrId);
  assert.ok(scoped, "hats defined → a set");
  assert.ok(scoped!.has(sumnerVision), "sees Sumner Vision");
  assert.ok(scoped!.has(sumnerPeds), "sees Sumner Pediatrics (location hat covers all depts)");
  assert.ok(scoped!.has(kingstonVision), "sees Kingston Vision");
  assert.ok(!scoped!.has(kingstonPeds), "must NOT see Kingston Pediatrics");
});

test("global department hat: Vision everywhere", async () => {
  await storage.setManagerScopes(mgrId, [{ locationId: null, departmentId: vision }]);
  const scoped = await storage.getManagerScopedUserIds(mgrId);
  assert.ok(scoped!.has(sumnerVision) && scoped!.has(kingstonVision), "sees Vision at both locations");
  assert.ok(!scoped!.has(sumnerPeds) && !scoped!.has(kingstonPeds), "does not see Pediatrics");
});

test("getScopedUserIds includes the manager themselves", async () => {
  await storage.setManagerScopes(mgrId, [{ locationId: sumner, departmentId: null }]);
  const mgr = (await storage.getUser(mgrId))!;
  const scoped = await storage.getScopedUserIds(mgr);
  assert.ok(scoped.has(mgrId), "manager sees self");
  assert.ok(scoped.has(sumnerVision) && scoped.has(sumnerPeds), "plus everyone at Sumner");
  assert.ok(!scoped.has(kingstonPeds), "but not Kingston");
});

test("department↔location mapping round-trips", async () => {
  await storage.setLocationDepartmentIds(sumner, [vision, peds]);
  await storage.setLocationDepartmentIds(kingston, [vision]);
  const atSumner = await storage.getLocationDepartmentIds(sumner);
  const atKingston = await storage.getLocationDepartmentIds(kingston);
  assert.deepEqual(atSumner.sort(), [vision, peds].sort(), "Sumner has both departments");
  assert.deepEqual(atKingston, [vision], "Kingston has only Vision");
  const visionLocs = await storage.getDepartmentLocationIds(vision);
  assert.deepEqual(visionLocs.sort(), [sumner, kingston].sort(), "Vision exists at both locations");
});

test.after(async () => {
  // Best-effort cleanup of the rows this suite created.
  await db.delete(schema.managerScopes).where(inArray(schema.managerScopes.userId, [mgrId]));
  await db.delete(schema.employeeLocations).where(inArray(schema.employeeLocations.userId, ids));
  await db.delete(schema.employeeDepartments).where(inArray(schema.employeeDepartments.userId, ids));
  await db.delete(schema.departmentLocations).where(inArray(schema.departmentLocations.locationId, [sumner, kingston]));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
});
