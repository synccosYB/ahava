import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import express from "express";
import { auditLogs, policies, users } from "@shared/schema";
import { db, pool } from "../db";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("policy assignment batches save atomically and reuse existing employee assignments", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  const payroll = await storage.getPolicyTypeByKey("payroll");
  assert.ok(admin && payroll, "seeded admin and payroll policy type are required");
  const [policy] = await db.insert(policies).values({
    name: "Batch assignment test " + randomUUID(),
    policyTypeId: payroll.id,
  }).returning();
  const employees = await db.insert(users).values(
    Array.from({ length: 3 }, () => ({ email: `${randomUUID()}@example.invalid`, role: "employee" })),
  ).returning({ id: users.id });
  const [first, second, third] = employees.map(({ id }) => ({ policyId: policy.id, userId: id }));
  const auditFilter = and(
    eq(auditLogs.action, "policy_assignment.created"),
    sql`${auditLogs.newValue}->>'policyId' = ${policy.id}`,
  );
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  t.after(async () => {
    await db.delete(auditLogs).where(auditFilter);
    await storage.deletePolicy(policy.id);
    await db.delete(users).where(inArray(users.id, employees.map(({ id }) => id)));
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/policy-assignments`;
  const token = generateToken(admin);
  const assign = (body: object) => fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const getAuditRows = () => db.select().from(auditLogs).where(auditFilter);

  await t.test("a missing employee rolls back the whole batch and its audit entries", async () => {
    const response = await assign([first, { ...second, userId: randomUUID() }]);
    assert.equal(response.status, 400);
    await response.text();
    assert.deepEqual(await storage.getPolicyAssignmentsByPolicy(policy.id), []);
    assert.deepEqual(await getAuditRows(), []);
  });

  await t.test("overlapping requests and retries create one row and audit entry per employee", async () => {
    const responses = await Promise.all([assign([first, second]), assign([first, third])]);
    for (const response of responses) assert.equal(response.status, 201);
    const [firstBatch, secondBatch] = await Promise.all(responses.map((response) => response.json()));
    assert.equal(firstBatch.length, 2);
    assert.equal(secondBatch.length, 2);
    assert.equal(firstBatch[0].id, secondBatch[0].id);
    const retry = await assign([first, second]);
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), firstBatch);
    const rows = await storage.getPolicyAssignmentsByPolicy(policy.id);
    assert.equal(rows.length, 3);
    assert.deepEqual(new Set(rows.map(({ userId }) => userId)), new Set(employees.map(({ id }) => id)));
    assert.equal((await getAuditRows()).length, 3);
  });

  await t.test("single non-employee assignments still return one assignment object", async () => {
    const response = await assign({ policyId: policy.id, employmentType: "full_time" });
    assert.equal(response.status, 201);
    const row = await response.json();
    assert.equal(row.policyId, policy.id);
    assert.equal(row.employmentType, "full_time");
  });
});
