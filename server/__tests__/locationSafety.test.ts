import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { registerRoutes } from "../routes";
import { generateToken } from "../middleware/auth";
import { users, companies, locations, locationCompanies, employeeLocations, punchLogs } from "@shared/schema";

test("location removal preserves linked records and supports reversible deactivation", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const [company] = await db.insert(companies).values({
    name: "Location safety test " + randomUUID(),
  }).returning();
  const companyId = company.id;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const token = generateToken({ id: admin.id, email: admin.email, role: admin.role, companyId: admin.companyId });
  const [employee] = await db.insert(users).values({
    email: "location-safety-" + randomUUID() + "@example.invalid",
    firstName: "Location",
    lastName: "Safety Test",
    role: "employee",
    companyId,
  }).returning();
  const locationIds: string[] = [];
  t.after(async () => {
    // Only remove the disposable rows created by this test.
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, employee.id));
    await db.delete(employeeLocations).where(eq(employeeLocations.userId, employee.id));
    await db.delete(users).where(eq(users.id, employee.id));
    for (const id of locationIds) {
      await db.delete(locationCompanies).where(eq(locationCompanies.locationId, id));
      await db.delete(locations).where(eq(locations.id, id));
    }
    await db.delete(companies).where(eq(companies.id, companyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });
  async function makeLocation(label: string) {
    const [location] = await db.insert(locations).values({
      companyId, name: "Location safety " + label,
      code: randomUUID().slice(0, 16), timezone: "America/New_York", isActive: true,
    }).returning();
    locationIds.push(location.id);
    await db.insert(locationCompanies).values({ locationId: location.id, companyId });
    return location;
  }
  async function request(method: string, id: string, body?: object) {
    const response = await fetch(baseUrl + "/api/locations/" + id, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  const assigned = await makeLocation("assigned");
  await db.insert(employeeLocations).values({ userId: employee.id, locationId: assigned.id });
  const [punch] = await db.insert(punchLogs).values({
    employeeId: employee.id, workDate: "2026-01-05",
    clockIn: new Date("2026-01-05T09:00:00Z"), clockOut: new Date("2026-01-05T17:00:00Z"),
    hoursWorked: 8, status: "complete", source: "test", approved: true,
  }).returning();

  await t.test("assigned location returns an actionable conflict without cascading assignments", async () => {
    const result = await request("DELETE", assigned.id);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "LOCATION_IN_USE");
    assert.ok(await storage.getLocation(assigned.id));
    const links = await db.select().from(employeeLocations).where(eq(employeeLocations.userId, employee.id));
    assert.equal(links.length, 1);
    assert.equal(links[0].locationId, assigned.id);
    assert.deepEqual(await storage.getLocationCompanyIds(assigned.id), [companyId]);
  });

  await t.test("a restrictive reference cannot remove the location's company links", async () => {
    const referenced = await makeLocation("referenced");
    await db.update(users).set({ locationId: referenced.id }).where(eq(users.id, employee.id));
    try {
      const result = await request("DELETE", referenced.id);
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "LOCATION_IN_USE");
      assert.ok(await storage.getLocation(referenced.id));
      assert.deepEqual(await storage.getLocationCompanyIds(referenced.id), [companyId]);
    } finally {
      await db.update(users).set({ locationId: null }).where(eq(users.id, employee.id));
    }
  });

  await t.test("deactivate and reactivate preserve assignments and attendance history", async () => {
    for (const isActive of [false, true]) {
      const result = await request("PATCH", assigned.id, { isActive });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal((await storage.getLocation(assigned.id))?.isActive, isActive);
      assert.deepEqual(await storage.getLocationCompanyIds(assigned.id), [companyId]);
      const links = await db.select().from(employeeLocations).where(eq(employeeLocations.userId, employee.id));
      assert.equal(links.length, 1);
      const after = await storage.getPunchLog(punch.id);
      assert.equal(Number(after?.hoursWorked), 8);
      assert.equal(after?.clockIn?.toISOString(), "2026-01-05T09:00:00.000Z");
      assert.equal(after?.clockOut?.toISOString(), "2026-01-05T17:00:00.000Z");
    }
  });

  await t.test("an unreferenced location can be deleted", async () => {
    const unused = await makeLocation("unused");
    const result = await request("DELETE", unused.id);
    assert.equal(result.status, 204);
    assert.equal(await storage.getLocation(unused.id), undefined);
    assert.deepEqual(await storage.getLocationCompanyIds(unused.id), []);
  });
});
