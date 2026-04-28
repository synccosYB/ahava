import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "../../db";
import { storage } from "../../storage";
import { registerRoutes } from "../../routes";
import { generateToken } from "../../middleware/auth";
import {
  policies,
  policyRules,
  policyAssignments,
  policyTypes,
  attendanceExceptions,
  punchLogs,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const REVIEWER_ID = "admin-dev-001";
const TEST_EMAIL_PREFIX = "task81-overtime-test+";
const TEST_POLICY_NAME_PREFIX = "Task81 Custom OT 10h ";

type TestFixture = {
  baseUrl: string;
  reviewerToken: string;
  employeeId: string;
  policyId: string;
  cleanup: () => Promise<void>;
};

async function purgeLeftoverTestData() {
  // Best-effort cleanup of any rows left over from a previously crashed test
  // run, so reruns don't trip unique constraints (email, etc.).
  const leftoverPolicies = await db.select().from(policies);
  const oldPolicies = leftoverPolicies.filter(
    (p) => p.name?.startsWith("Task81 Custom OT 10h") || p.name?.startsWith("Task81 Custom DT 13h"),
  );
  for (const p of oldPolicies) {
    await db.delete(policyAssignments).where(eq(policyAssignments.policyId, p.id));
    await db.delete(policyRules).where(eq(policyRules.policyId, p.id));
    await db.delete(policies).where(eq(policies.id, p.id));
  }
  const leftoverUsers = await db.select().from(users);
  const oldUsers = leftoverUsers.filter((u) => u.email?.startsWith(TEST_EMAIL_PREFIX));
  for (const u of oldUsers) {
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, u.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
}

async function setupFixture(label: string): Promise<TestFixture> {
  await purgeLeftoverTestData();

  // Boot a fresh express app and register routes (no auth middleware bypass).
  const app = express();
  app.use(express.json());
  const httpServer = http.createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Reviewer must exist (seeded). Generate a JWT for it.
  const reviewer = await storage.getUser(REVIEWER_ID);
  assert.ok(reviewer, "expected seeded admin-dev-001 user");
  const reviewerToken = generateToken({
    id: reviewer.id,
    email: reviewer.email,
    role: reviewer.role,
    companyId: reviewer.companyId,
  });

  // Employee under test (lives in the same company as the reviewer so admin
  // scoping covers them).
  const employeeEmail = `${TEST_EMAIL_PREFIX}${label}@example.invalid`;
  const [employee] = await db
    .insert(users)
    .values({
      email: employeeEmail,
      firstName: "Task81",
      lastName: "Tester",
      role: "employee",
      companyId: reviewer.companyId,
    })
    .returning();

  // Look up the seeded "attendance" policy type.
  const [attendanceType] = await db
    .select()
    .from(policyTypes)
    .where(eq(policyTypes.key, "attendance"));
  assert.ok(attendanceType, "expected seeded attendance policy type");

  // Insert a non-default attendance policy (otThresholdDaily=10) and assign it
  // to the employee directly so getEffectivePolicy resolves it deterministically.
  const [policy] = await db
    .insert(policies)
    .values({
      companyId: reviewer.companyId,
      policyTypeId: attendanceType.id,
      name: `${TEST_POLICY_NAME_PREFIX}${label}`,
      status: "active",
    })
    .returning();
  await db.insert(policyRules).values({
    policyId: policy.id,
    rules: {
      roundingRule: "none",
      roundingIntervalMinutes: 15,
      otThresholdDaily: 10,
    },
  });
  await db.insert(policyAssignments).values({
    policyId: policy.id,
    userId: employee.id,
  });

  const cleanup = async () => {
    // Order matters: clear FK children before parents. Catch ALL policy
    // assignments for this employee so additional policies attached during a
    // test (e.g. payroll override) don't block the user delete. Audit log
    // rows reference the (never-deleted) seeded admin actor and have no FK
    // back to the exception/punch, so they're left in place.
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employee.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, employee.id));
    await db.delete(policyAssignments).where(eq(policyAssignments.userId, employee.id));
    await db.delete(policyRules).where(eq(policyRules.policyId, policy.id));
    await db.delete(policies).where(eq(policies.id, policy.id));
    await db.delete(users).where(eq(users.id, employee.id));
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  };

  return { baseUrl, reviewerToken, employeeId: employee.id, policyId: policy.id, cleanup };
}

test("POST /attendance/exceptions/:id/resolve uses the configured 10h OT threshold (not hard-coded 8h)", async (t) => {
  const fx = await setupFixture("ot-threshold");
  t.after(fx.cleanup);

  // Create an open punch from 9 hours ago. Under the old hard-coded 8h check
  // this would be marked "overtime"; under the configured 10h threshold it
  // must come back as "complete".
  const workDate = "2026-04-21";
  const clockInAt = new Date("2026-04-21T08:00:00Z");
  const correctedClockOutAt = new Date("2026-04-21T17:00:00Z"); // 9h shift
  const [punch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate,
      clockIn: clockInAt,
      roundedClockIn: clockInAt,
      status: "in-progress",
      source: "test",
      approved: true,
    })
    .returning();

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: correctedClockOutAt,
      type: "forgotten_clock_out",
      reason: "regression test for task #81",
      status: "pending",
    })
    .returning();

  const res = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${exception.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({
      action: "approve",
      correctedTime: correctedClockOutAt.toISOString(),
      reviewNotes: "approved via integration test",
    }),
  });
  assert.equal(res.status, 200, `expected 200 from resolve route, got ${res.status} (${await res.text().catch(() => "")})`);

  const [updatedPunch] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, punch.id));
  assert.ok(updatedPunch, "punch row should still exist");
  assert.equal(updatedPunch.hoursWorked, 9, "hoursWorked should be 9 for an 8am-5pm shift");
  assert.equal(
    updatedPunch.status,
    "complete",
    "status must be 'complete' under the 10h OT policy (was 'overtime' with the hard-coded 8h bug)",
  );
  assert.ok(updatedPunch.clockOut, "clockOut should be filled in");
  assert.ok(updatedPunch.roundedClockOut, "roundedClockOut should be populated to match a normal clock-out");
  assert.equal(
    new Date(updatedPunch.clockOut!).getTime(),
    correctedClockOutAt.getTime(),
    "clockOut should reflect the corrected timestamp",
  );

  const [resolvedException] = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.id, exception.id));
  assert.equal(resolvedException.status, "approved");
  assert.equal(resolvedException.punchLogId, punch.id);
});

test("POST /attendance/exceptions/:id/resolve splits OT/double-time using policy thresholds", async (t) => {
  const fx = await setupFixture("ot-dt-split");
  t.after(fx.cleanup);

  // Layer a payroll policy with doubleTimeThresholdDaily=13 on top of the
  // existing 10h OT attendance policy created in setupFixture.
  const [payrollType] = await db
    .select()
    .from(policyTypes)
    .where(eq(policyTypes.key, "payroll"));
  assert.ok(payrollType, "expected seeded payroll policy type");
  const reviewer = await storage.getUser(REVIEWER_ID);
  const [payrollPolicy] = await db
    .insert(policies)
    .values({
      companyId: reviewer!.companyId,
      policyTypeId: payrollType.id,
      name: "Task81 Custom DT 13h",
      status: "active",
    })
    .returning();
  await db.insert(policyRules).values({
    policyId: payrollPolicy.id,
    rules: {
      overtimeMultiplier: 1.5,
      doubleTimeMultiplier: 2.0,
      doubleTimeThresholdDaily: 13,
    },
  });
  await db.insert(policyAssignments).values({
    policyId: payrollPolicy.id,
    userId: fx.employeeId,
  });
  t.after(async () => {
    await db.delete(policyAssignments).where(eq(policyAssignments.policyId, payrollPolicy.id));
    await db.delete(policyRules).where(eq(policyRules.policyId, payrollPolicy.id));
    await db.delete(policies).where(eq(policies.id, payrollPolicy.id));
  });

  // 14h shift on the same day under OT=10h, DT=13h should yield status overtime.
  const workDate = "2026-04-22";
  const clockInAt = new Date("2026-04-22T06:00:00Z");
  const correctedClockOutAt = new Date("2026-04-22T20:00:00Z"); // 14h
  const [punch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate,
      clockIn: clockInAt,
      roundedClockIn: clockInAt,
      status: "in-progress",
      source: "test",
      approved: true,
    })
    .returning();

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: correctedClockOutAt,
      type: "forgotten_clock_out",
      reason: "regression test for task #81 (OT/DT split)",
      status: "pending",
    })
    .returning();

  const res = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${exception.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({
      action: "approve",
      correctedTime: correctedClockOutAt.toISOString(),
    }),
  });
  assert.equal(res.status, 200, `expected 200 from resolve route, got ${res.status}`);

  const [updatedPunch] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, punch.id));
  assert.equal(updatedPunch.hoursWorked, 14);
  assert.equal(
    updatedPunch.status,
    "overtime",
    "status must be 'overtime' for a 14h shift past the 10h OT threshold",
  );
});
