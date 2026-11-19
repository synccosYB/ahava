/**
 * Changing an employee's company must NOT clear their department or location.
 * Regression for the report that moving an employee to another company silently
 * reset both.
 *
 * Run with: `npx tsx server/__tests__/assignDivisionKeepsAssignments.test.ts` (needs DATABASE_URL + seed).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { companies, departments, locations, users } from "@shared/schema";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("POST /api/users/bulk-assign-division keeps department & location on a company change", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const token = generateToken(admin);

  const stamp = Date.now().toString(36);
  const fromCo = await storage.createCompany({ name: `From ${stamp}` });
  const toCo = await storage.createCompany({ name: `To ${stamp}` });
  const dept = await storage.createDepartment({ companyId: fromCo.id, name: `Dept ${stamp}` });
  const loc = await storage.createLocation({ companyId: fromCo.id, name: `Loc ${stamp}` });
  const emp = await storage.createUser({
    firstName: "Move", lastName: stamp, role: "employee",
    companyId: fromCo.id, departmentId: dept.id, locationId: loc.id,
  });

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(users).where(inArray(users.id, [emp.id])).catch(() => {});
    await db.delete(departments).where(inArray(departments.id, [dept.id])).catch(() => {});
    await db.delete(locations).where(inArray(locations.id, [loc.id])).catch(() => {});
    await db.delete(companies).where(inArray(companies.id, [fromCo.id, toCo.id])).catch(() => {});
  });

  const res = await fetch(`${origin}/api/users/bulk-assign-division`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // No keepCompatible flag — the whole point is that the default no longer clears.
    body: JSON.stringify({ userIds: [emp.id], companyId: toCo.id }),
  });
  assert.equal(res.status, 200, "assign succeeded");

  const after = await storage.getUser(emp.id);
  assert.equal(after?.companyId, toCo.id, "company changed");
  assert.equal(after?.departmentId, dept.id, "department preserved (not reset)");
  assert.equal(after?.locationId, loc.id, "location preserved (not reset)");
});
