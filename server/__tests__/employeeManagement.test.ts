import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import { auditLogs, offboardingChecklists, punchLogs, userEmploymentProfiles, users } from "@shared/schema";
import { db, pool } from "../db";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("Employees API supports blank contact fields, fresh reads and reinstatement", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const token = generateToken(admin);
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lastName = `Employees QA ${randomUUID()}`;
  t.after(async () => {
    try {
      const created = await db.select({ id: users.id }).from(users).where(eq(users.lastName, lastName));
      const ids = created.map(({ id }) => id);
      if (ids.length) {
        const checklists = await db.select({ id: offboardingChecklists.id }).from(offboardingChecklists)
          .where(inArray(offboardingChecklists.employeeId, ids));
        await db.delete(auditLogs).where(inArray(auditLogs.targetId, [...ids, ...checklists.map(({ id }) => id)]));
        await db.delete(punchLogs).where(inArray(punchLogs.employeeId, ids));
        await db.delete(offboardingChecklists).where(inArray(offboardingChecklists.employeeId, ids));
        await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, ids));
        await db.delete(users).where(inArray(users.id, ids));
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    }
  });

  function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(origin + path, { ...init, headers });
  }
  function post(path: string, body: object) {
    return request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  function createEmployee(firstName: string, options: object = {}) {
    return post("/api/users", { firstName, lastName, taxClassification: "Volunteer", payType: "contractual", skipOnboarding: true, ...options });
  }

  const [nullContact, blankContact, omittedContact] = await Promise.all([
    createEmployee("No Contact", { email: null, phone: null }),
    createEmployee("Blank Contact", { email: "  ", phone: "" }),
    createEmployee("Omitted Contact"),
  ]);
  const employees = await Promise.all([nullContact, blankContact, omittedContact].map(async (response) => {
    assert.equal(response.status, 201, `creation failed: ${await response.clone().text()}`);
    const employee = await response.json();
    assert.equal(employee.email, null);
    assert.equal(employee.phone, null);
    assert.match(employee.employeeNumber, /^\d+$/);
    return employee;
  }));
  assert.equal(new Set(employees.map((employee) => employee.employeeNumber)).size, 3);
  const [employee, legacyEmployee] = employees;

  const invalid = await createEmployee("Invalid Email", { email: "invalid" });
  assert.equal(invalid.status, 400);
  assert.ok((await invalid.json()).errors.fieldErrors.email);

  const email = `${randomUUID()}@example.invalid`;
  const withEmail = await createEmployee("With Email", { email: ` ${email.toUpperCase()} ` });
  assert.equal(withEmail.status, 201);
  assert.equal((await withEmail.json()).email, email);
  const duplicate = await createEmployee("Duplicate Email", { email });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "EMAIL_ALREADY_EXISTS");

  const brokenAssignment = await createEmployee("Bad Assignment", { locationIds: [randomUUID()] });
  assert.ok(brokenAssignment.status >= 400);
  assert.equal((await storage.getUsersPage({ search: `Bad Assignment ${lastName}`, limit: 25, offset: 0 })).total, 0);

  const numberPreview = await request("/api/users/next-employee-number");
  assert.equal(numberPreview.status, 200);
  assert.match((await numberPreview.json()).nextNumber, /^\d+$/);

  const listPath = `/api/users?limit=25&search=${encodeURIComponent(lastName)}`;
  const inactivePath = `${listPath}&status=inactive`;
  const activePath = `${listPath}&status=active`;
  async function listIds(path: string, init?: RequestInit) {
    const response = await request(path, init);
    assert.equal(response.status, 200);
    return (await response.json()).data.map((row: { id: string }) => row.id);
  }
  assert.deepEqual(await listIds(inactivePath), []);
  assert.ok((await listIds(activePath)).includes(employee.id));

  const terminationDate = "2026-01-05";
  const [completedChecklist] = await db.insert(offboardingChecklists).values({
    employeeId: employee.id, terminationDate, status: "in_progress",
  }).returning();
  const [punch] = await db.insert(punchLogs).values({
    employeeId: employee.id, workDate: terminationDate,
    clockIn: new Date("2026-01-05T09:00:00Z"), clockOut: new Date("2026-01-05T17:00:00Z"),
    hoursWorked: 8, status: "complete", source: "test", approved: true,
  }).returning();

  // A separate writer can change the roster while the API has a cached copy.
  await storage.setUserDeactivated(legacyEmployee.id, admin.id);
  assert.deepEqual(await listIds(inactivePath), []);
  assert.deepEqual(await listIds(inactivePath, { cache: "no-store" }), [legacyEmployee.id]);
  assert.equal((await post(`/api/users/${legacyEmployee.id}/reactivate`, {})).status, 200);

  const offboard = await post(`/api/offboarding-checklists/${completedChecklist.id}/deactivate`, { terminationReason: "Resigned" });
  assert.equal(offboard.status, 200, await offboard.clone().text());
  const inactive = await request(`/api/users/${employee.id}`);
  assert.equal(inactive.status, 200);
  const profile = await inactive.json();
  assert.ok(profile.deactivatedAt);
  assert.equal(profile.terminationReason, "Resigned");
  assert.equal(profile.password, undefined);
  assert.equal(profile.passwordHash, undefined);
  assert.equal((await storage.getEmploymentProfile(employee.id))?.terminationDate, terminationDate);
  assert.deepEqual(await listIds(inactivePath), [employee.id]);
  assert.ok(!(await listIds(activePath)).includes(employee.id));

  const [pendingChecklist] = await db.insert(offboardingChecklists).values({ employeeId: employee.id, terminationDate }).returning();
  const reactivationPath = `/api/users/${employee.id}/reactivate`;
  const reinstatements = await Promise.all([post(reactivationPath, {}), post(reactivationPath, {})]);
  for (const reinstatement of reinstatements) {
    assert.equal(reinstatement.status, 200, await reinstatement.clone().text());
    assert.equal((await reinstatement.json()).deactivatedAt, null);
  }

  assert.equal((await storage.getEmploymentProfile(employee.id))?.terminationDate, null);
  assert.equal((await storage.getOffboardingChecklist(completedChecklist.id))?.status, "completed");
  assert.equal((await storage.getOffboardingChecklist(pendingChecklist.id))?.status, "cancelled");
  assert.equal(Number((await storage.getPunchLog(punch.id))?.hoursWorked), 8);
  assert.deepEqual(await listIds(inactivePath), []);
  assert.ok((await listIds(activePath)).includes(employee.id));

  const events = await db.select().from(auditLogs).where(eq(auditLogs.targetId, employee.id));
  const reinstatementAudits = events.filter((event) => event.action === "user.reactivate");
  assert.equal(reinstatementAudits.length, 1);
  assert.deepEqual(reinstatementAudits[0].oldValue, {
    deactivatedAt: profile.deactivatedAt, terminationDate, terminationReason: "Resigned",
  });
  assert.equal((await post(`/api/offboarding-checklists/${completedChecklist.id}/deactivate`, {})).status, 409);
  assert.equal((await storage.getEmploymentProfile(employee.id))?.terminationDate, null);
  assert.equal((await storage.getUser(employee.id))?.deactivatedAt, null);
});
