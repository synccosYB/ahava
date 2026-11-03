/**
 * Chain-of-command ranks + unlock rule (account edit-lock).
 *
 * Verifies getUserRank derives rank from role + manager hats, that outranks()
 * encodes "strictly higher authority" (so an owner can't act on another owner),
 * and that canUnlock() lets only the locker's rank-or-higher unlock.
 *
 * Run with: `npx tsx server/__tests__/rankLock.test.ts` (requires DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { getUserRank, outranks, canUnlock, RANK } from "../services/rank";

const stamp = `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const ids: string[] = [];

async function makeUser(tag: string, role: "admin" | "manager" | "employee"): Promise<schema.User> {
  const id = `${stamp}-${tag}`;
  const [u] = await db.insert(schema.users).values({ id, email: `${id}@test.local`, firstName: tag, lastName: "T", role }).returning();
  ids.push(id);
  return u as schema.User;
}

const company = (await db.insert(schema.companies).values({ name: `RankCo-${stamp}` }).returning())[0];
const loc = (await db.insert(schema.locations).values({ companyId: company.id, name: `Loc-${stamp}` }).returning())[0];
const dept = (await db.insert(schema.departments).values({ name: `Dept-${stamp}` }).returning())[0];

const owner = await makeUser("owner", "admin");
const employee = await makeUser("emp", "employee");
const locationMgr = await makeUser("locmgr", "manager");
const globalDeptMgr = await makeUser("gdmgr", "manager");
const localDeptMgr = await makeUser("ldmgr", "manager");
await storage.setManagerScopes(locationMgr.id, [{ locationId: loc.id, departmentId: null }]);
await storage.setManagerScopes(globalDeptMgr.id, [{ locationId: null, departmentId: dept.id }]);
await storage.setManagerScopes(localDeptMgr.id, [{ locationId: loc.id, departmentId: dept.id }]);

test("getUserRank derives rank from role + hats", async () => {
  assert.equal(await getUserRank(owner), RANK.OWNER);
  assert.equal(await getUserRank(employee), RANK.EMPLOYEE);
  assert.equal(await getUserRank(locationMgr), RANK.LOCATION_MANAGER);
  assert.equal(await getUserRank(globalDeptMgr), RANK.GLOBAL_DEPT_MANAGER);
  assert.equal(await getUserRank(localDeptMgr), RANK.LOCAL_DEPT_MANAGER);
});

test("outranks: strictly higher authority; equals can't act on each other", () => {
  assert.ok(outranks(RANK.OWNER, RANK.LOCATION_MANAGER));
  assert.ok(outranks(RANK.LOCATION_MANAGER, RANK.LOCAL_DEPT_MANAGER));
  assert.ok(!outranks(RANK.OWNER, RANK.OWNER), "an owner can't act on another owner");
  assert.ok(!outranks(RANK.LOCAL_DEPT_MANAGER, RANK.LOCAL_DEPT_MANAGER), "a local dept mgr can't act on a peer");
  assert.ok(!outranks(RANK.LOCAL_DEPT_MANAGER, RANK.OWNER), "lower can't act on higher");
  assert.ok(outranks(RANK.SUPER_ADMIN, RANK.OWNER), "super admin outranks an owner");
});

test("canUnlock: only the locker's rank or higher may unlock", () => {
  // Super admin locked (rank 1): only super admin can unlock.
  assert.ok(canUnlock(RANK.SUPER_ADMIN, RANK.SUPER_ADMIN));
  assert.ok(!canUnlock(RANK.OWNER, RANK.SUPER_ADMIN), "an owner can't unlock what a super admin locked");
  // Owner locked (rank 2): any owner (or super) can unlock.
  assert.ok(canUnlock(RANK.OWNER, RANK.OWNER), "another owner can unlock an owner's lock");
  assert.ok(canUnlock(RANK.SUPER_ADMIN, RANK.OWNER));
  assert.ok(!canUnlock(RANK.LOCATION_MANAGER, RANK.OWNER), "a location mgr can't unlock an owner's lock");
  // Location mgr locked (rank 3): location mgr or higher.
  assert.ok(canUnlock(RANK.LOCATION_MANAGER, RANK.LOCATION_MANAGER));
  assert.ok(!canUnlock(RANK.LOCAL_DEPT_MANAGER, RANK.LOCATION_MANAGER));
});

test("lock fields round-trip on the user row", async () => {
  await storage.updateUser(employee.id, {
    editLocked: true, lockedByUserId: owner.id, lockedByRank: RANK.OWNER, lockedAt: new Date(),
  } as any);
  const locked = await storage.getUser(employee.id);
  assert.equal(locked?.editLocked, true);
  assert.equal(locked?.lockedByRank, RANK.OWNER);
  await storage.updateUser(employee.id, { editLocked: false, lockedByUserId: null, lockedByRank: null, lockedAt: null } as any);
  const unlocked = await storage.getUser(employee.id);
  assert.equal(unlocked?.editLocked, false);
});

test.after(async () => {
  await db.delete(schema.managerScopes).where(inArray(schema.managerScopes.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
});
