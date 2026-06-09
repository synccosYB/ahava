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
import { eq, and } from "drizzle-orm";

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

test("POST /attendance/exceptions/:id/resolve applies both correctedClockIn and correctedClockOut for a time_correction approval", async (t) => {
  const fx = await setupFixture("time-correction-both");
  t.after(fx.cleanup);

  // Existing closed punch: 9:00–17:00 (8h). Reviewer is correcting the
  // employee's punch to 8:30–17:30 (9h) so both sides shift.
  const workDate = "2026-04-23";
  const originalClockIn = new Date("2026-04-23T09:00:00Z");
  const originalClockOut = new Date("2026-04-23T17:00:00Z");
  const correctedClockIn = new Date("2026-04-23T08:30:00Z");
  const correctedClockOut = new Date("2026-04-23T17:30:00Z");
  const [punch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate,
      clockIn: originalClockIn,
      roundedClockIn: originalClockIn,
      clockOut: originalClockOut,
      roundedClockOut: originalClockOut,
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: correctedClockIn,
      type: "time_correction",
      reason:
        "I forgot to log my real start/end. [Original In: 09:00, Original Out: 17:00, Corrected In: 08:30, Corrected Out: 17:30]",
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
      reviewNotes: "approving full time correction",
      correctedClockIn: correctedClockIn.toISOString(),
      correctedClockOut: correctedClockOut.toISOString(),
    }),
  });
  assert.equal(
    res.status,
    200,
    `expected 200 from resolve route, got ${res.status} (${await res.text().catch(() => "")})`,
  );

  const [updatedPunch] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, punch.id));
  assert.ok(updatedPunch, "punch row should still exist after correction");
  assert.equal(
    new Date(updatedPunch.clockIn!).getTime(),
    correctedClockIn.getTime(),
    "clockIn should reflect the corrected timestamp",
  );
  assert.equal(
    new Date(updatedPunch.clockOut!).getTime(),
    correctedClockOut.getTime(),
    "clockOut should reflect the corrected timestamp",
  );
  assert.equal(
    updatedPunch.hoursWorked,
    9,
    "hoursWorked should be recomputed from the corrected in/out (8:30–17:30 = 9h)",
  );
  assert.equal(updatedPunch.status, "complete", "status should still be complete under the 10h OT policy");
  assert.ok(updatedPunch.roundedClockIn, "roundedClockIn should be populated after correcting both sides");
  assert.ok(updatedPunch.roundedClockOut, "roundedClockOut should be populated after correcting both sides");

  const [resolvedException] = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.id, exception.id));
  assert.equal(resolvedException.status, "approved");
  assert.equal(resolvedException.punchLogId, punch.id);
});

test("POST /attendance/exceptions/:id/resolve rejects a time_correction approval with no corrected times", async (t) => {
  const fx = await setupFixture("time-correction-missing-times");
  t.after(fx.cleanup);

  const workDate = "2026-04-24";
  const clockIn = new Date("2026-04-24T09:00:00Z");
  const clockOut = new Date("2026-04-24T17:00:00Z");
  await db.insert(punchLogs).values({
    employeeId: fx.employeeId,
    workDate,
    clockIn,
    roundedClockIn: clockIn,
    clockOut,
    roundedClockOut: clockOut,
    hoursWorked: 8,
    status: "complete",
    source: "test",
    approved: true,
  });

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: clockOut,
      type: "time_correction",
      reason: "legacy request without bracketed time info",
      status: "pending",
    })
    .returning();

  const res = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${exception.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(res.status, 400, "approval without any corrected times must 400");
  const body = await res.json();
  assert.match(
    String(body.message || ""),
    /correctedClockIn.*correctedClockOut|correctedClockOut.*correctedClockIn/,
    "error message should name both correctedClockIn and correctedClockOut",
  );
});

test("POST /attendance/exceptions/:id/resolve still denies a time_correction without any corrected times", async (t) => {
  const fx = await setupFixture("time-correction-deny-no-times");
  t.after(fx.cleanup);

  const workDate = "2026-04-25";
  const clockIn = new Date("2026-04-25T09:00:00Z");
  const clockOut = new Date("2026-04-25T17:00:00Z");
  await db.insert(punchLogs).values({
    employeeId: fx.employeeId,
    workDate,
    clockIn,
    roundedClockIn: clockIn,
    clockOut,
    roundedClockOut: clockOut,
    hoursWorked: 8,
    status: "complete",
    source: "test",
    approved: true,
  });

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: clockOut,
      type: "time_correction",
      reason: "asking to deny this",
      status: "pending",
    })
    .returning();

  const res = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${exception.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({ action: "deny", reviewNotes: "not legitimate" }),
  });
  assert.equal(res.status, 200, "denying a time_correction must succeed without corrected times");

  const [resolved] = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.id, exception.id));
  assert.equal(resolved.status, "denied");
});

test("POST /attendance/exceptions/:id/resolve approves a time_correction for an older date even when newer punches exist (Task #176)", async (t) => {
  const fx = await setupFixture("time-correction-older-date");
  t.after(fx.cleanup);

  // Older closed punch on the correction date: 9:00–17:00 (8h).
  const correctionDate = "2026-04-20";
  const olderClockIn = new Date("2026-04-20T09:00:00Z");
  const olderClockOut = new Date("2026-04-20T17:00:00Z");
  const [olderPunch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate: correctionDate,
      clockIn: olderClockIn,
      roundedClockIn: olderClockIn,
      clockOut: olderClockOut,
      roundedClockOut: olderClockOut,
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();

  // Newer punch on a later date (created AFTER the older one, so it's the
  // "latest" record for the employee). This is the scenario that used to 400.
  const newerDate = "2026-04-27";
  const newerClockIn = new Date("2026-04-27T08:00:00Z");
  const newerClockOut = new Date("2026-04-27T16:00:00Z");
  const [newerPunch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate: newerDate,
      clockIn: newerClockIn,
      roundedClockIn: newerClockIn,
      clockOut: newerClockOut,
      roundedClockOut: newerClockOut,
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();

  // Time-correction exception targets the OLDER date.
  const correctedClockIn = new Date("2026-04-20T08:30:00Z");
  const correctedClockOut = new Date("2026-04-20T17:30:00Z");
  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: correctionDate,
      exceptionTime: correctedClockIn,
      type: "time_correction",
      reason:
        "Forgot real start/end on 2026-04-20. [Original In: 09:00, Original Out: 17:00, Corrected In: 08:30, Corrected Out: 17:30]",
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
      reviewNotes: "approving older-date correction",
      correctedClockIn: correctedClockIn.toISOString(),
      correctedClockOut: correctedClockOut.toISOString(),
    }),
  });
  assert.equal(
    res.status,
    200,
    `expected 200 from resolve route, got ${res.status} (${await res.text().catch(() => "")})`,
  );

  const [updatedOlder] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, olderPunch.id));
  assert.ok(updatedOlder, "older punch row should still exist");
  assert.equal(
    new Date(updatedOlder.clockIn!).getTime(),
    correctedClockIn.getTime(),
    "older punch clockIn should reflect the corrected timestamp",
  );
  assert.equal(
    new Date(updatedOlder.clockOut!).getTime(),
    correctedClockOut.getTime(),
    "older punch clockOut should reflect the corrected timestamp",
  );
  assert.equal(updatedOlder.hoursWorked, 9, "older punch hoursWorked should be recomputed (8:30–17:30 = 9h)");

  // The newer punch must be untouched.
  const [untouchedNewer] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, newerPunch.id));
  assert.ok(untouchedNewer, "newer punch row should still exist");
  assert.equal(
    new Date(untouchedNewer.clockIn!).getTime(),
    newerClockIn.getTime(),
    "newer punch clockIn must not have changed",
  );
  assert.equal(
    new Date(untouchedNewer.clockOut!).getTime(),
    newerClockOut.getTime(),
    "newer punch clockOut must not have changed",
  );
  assert.equal(untouchedNewer.hoursWorked, 8, "newer punch hoursWorked must not have changed");

  const [resolvedException] = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.id, exception.id));
  assert.equal(resolvedException.status, "approved");
  assert.equal(
    resolvedException.punchLogId,
    olderPunch.id,
    "exception should link to the older (correction-date) punch, not the newer one",
  );
});

test("POST /attendance/exceptions targeting a specific punch (Task #183) updates that punch even when a newer punch exists on the same date", async (t) => {
  const fx = await setupFixture("target-punch-fk-time-correction");
  t.after(fx.cleanup);

  // Same employee, same workDate, two distinct punches — e.g. an overnight
  // split or a manual fix that produced two rows. The OLDER one (created
  // first) is the one the employee wants corrected, but the legacy
  // date-based lookup would silently pick the NEWER one because it has the
  // higher createdAt. With the punchLogId FK populated at submission time,
  // the resolve handler must operate on the punch the employee picked.
  const workDate = "2026-04-26";
  const olderClockIn = new Date("2026-04-26T02:00:00Z");
  const olderClockOut = new Date("2026-04-26T08:00:00Z");
  const [olderPunch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate,
      clockIn: olderClockIn,
      roundedClockIn: olderClockIn,
      clockOut: olderClockOut,
      roundedClockOut: olderClockOut,
      hoursWorked: 6,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();
  // Force a measurable createdAt gap so the "latest by createdAt" query is
  // deterministic across both rows.
  await new Promise((r) => setTimeout(r, 10));
  const newerClockIn = new Date("2026-04-26T14:00:00Z");
  const newerClockOut = new Date("2026-04-26T22:00:00Z");
  const [newerPunch] = await db
    .insert(punchLogs)
    .values({
      employeeId: fx.employeeId,
      workDate,
      clockIn: newerClockIn,
      roundedClockIn: newerClockIn,
      clockOut: newerClockOut,
      roundedClockOut: newerClockOut,
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();

  // Submit the correction request through the public API so we exercise the
  // FK-validation path on the POST endpoint as well.
  const employee = await storage.getUser(fx.employeeId);
  assert.ok(employee);
  const employeeToken = generateToken({
    id: employee.id,
    email: employee.email,
    role: employee.role,
    companyId: employee.companyId,
  });
  const correctedClockIn = new Date("2026-04-26T01:30:00Z");
  const correctedClockOut = new Date("2026-04-26T08:30:00Z");
  const submitRes = await fetch(`${fx.baseUrl}/api/attendance/exceptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({
      exceptionDate: workDate,
      type: "time_correction",
      reason:
        "Fixing the early morning shift, not the evening one. [Original In: 02:00, Original Out: 08:00, Corrected In: 01:30, Corrected Out: 08:30]",
      punchLogId: olderPunch.id,
    }),
  });
  const submitBody = await submitRes.text();
  assert.equal(
    submitRes.status,
    201,
    `expected 201 from POST /api/attendance/exceptions, got ${submitRes.status} (${submitBody})`,
  );
  const created = JSON.parse(submitBody);
  assert.equal(created.punchLogId, olderPunch.id, "submitted exception should carry the FK");

  const resolveRes = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${created.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({
      action: "approve",
      reviewNotes: "approve via FK target",
      correctedClockIn: correctedClockIn.toISOString(),
      correctedClockOut: correctedClockOut.toISOString(),
    }),
  });
  assert.equal(
    resolveRes.status,
    200,
    `expected 200 from resolve route, got ${resolveRes.status} (${await resolveRes.text().catch(() => "")})`,
  );

  const [updatedOlder] = await db.select().from(punchLogs).where(eq(punchLogs.id, olderPunch.id));
  assert.equal(
    new Date(updatedOlder.clockIn!).getTime(),
    correctedClockIn.getTime(),
    "the FK-targeted (older) punch must be updated",
  );
  assert.equal(
    new Date(updatedOlder.clockOut!).getTime(),
    correctedClockOut.getTime(),
    "the FK-targeted (older) punch clockOut must be updated",
  );
  assert.equal(updatedOlder.hoursWorked, 7, "older punch hours should be 1:30–8:30 = 7h");

  // The "later in createdAt" punch must NOT have been touched, which used to
  // be the bug under the date-based lookup.
  const [untouchedNewer] = await db.select().from(punchLogs).where(eq(punchLogs.id, newerPunch.id));
  assert.equal(
    new Date(untouchedNewer.clockIn!).getTime(),
    newerClockIn.getTime(),
    "the non-targeted (newer) punch clockIn must not have changed",
  );
  assert.equal(
    new Date(untouchedNewer.clockOut!).getTime(),
    newerClockOut.getTime(),
    "the non-targeted (newer) punch clockOut must not have changed",
  );
  assert.equal(untouchedNewer.hoursWorked, 8, "the non-targeted (newer) punch hoursWorked must not have changed");

  const [resolved] = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.id, created.id));
  assert.equal(resolved.status, "approved");
  assert.equal(
    resolved.punchLogId,
    olderPunch.id,
    "post-resolve punchLogId should record the FK-targeted punch",
  );
});

test("POST /attendance/exceptions rejects a punchLogId that belongs to another employee (Task #183)", async (t) => {
  const fx = await setupFixture("target-punch-fk-cross-user");
  t.after(fx.cleanup);

  // A second employee in the same company with their own punch.
  const otherEmail = `${TEST_EMAIL_PREFIX}target-fk-other@example.invalid`;
  const reviewer = await storage.getUser(REVIEWER_ID);
  const [otherEmployee] = await db
    .insert(users)
    .values({
      email: otherEmail,
      firstName: "Task183",
      lastName: "Other",
      role: "employee",
      companyId: reviewer!.companyId,
    })
    .returning();
  t.after(async () => {
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, otherEmployee.id));
    await db.delete(users).where(eq(users.id, otherEmployee.id));
  });

  const workDate = "2026-04-26";
  const [otherPunch] = await db
    .insert(punchLogs)
    .values({
      employeeId: otherEmployee.id,
      workDate,
      clockIn: new Date("2026-04-26T09:00:00Z"),
      roundedClockIn: new Date("2026-04-26T09:00:00Z"),
      clockOut: new Date("2026-04-26T17:00:00Z"),
      roundedClockOut: new Date("2026-04-26T17:00:00Z"),
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();

  const employee = await storage.getUser(fx.employeeId);
  assert.ok(employee);
  const employeeToken = generateToken({
    id: employee.id,
    email: employee.email,
    role: employee.role,
    companyId: employee.companyId,
  });

  const res = await fetch(`${fx.baseUrl}/api/attendance/exceptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({
      exceptionDate: workDate,
      type: "time_correction",
      reason: "trying to target someone else's punch",
      punchLogId: otherPunch.id,
    }),
  });
  assert.equal(res.status, 400, "must reject submission targeting another employee's punch");
  const body = await res.json().catch(() => ({}));
  assert.match(
    String(body.message ?? ""),
    /Invalid punch reference/i,
    "should report invalid punch reference",
  );
});

test("POST /attendance/exceptions: a forgotten_clock_out approval closes the existing open punch and never creates a duplicate (BUG-0246)", async (t) => {
  const fx = await setupFixture("forgotten-clock-out-no-dup");
  t.after(fx.cleanup);

  // The employee clocked in but forgot to clock out — one open punch exists.
  const workDate = "2026-05-04";
  const clockInAt = new Date("2026-05-04T09:00:00Z");
  const correctedClockOutAt = new Date("2026-05-04T17:00:00Z"); // 8h shift
  const [openPunch] = await db
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

  // Submit the correction through the public API exactly like the My
  // Attendance page now does: type forgotten_clock_out, linked to the open
  // punch, with the corrected clock-out carried in the bracketed reason.
  const employee = await storage.getUser(fx.employeeId);
  assert.ok(employee);
  const employeeToken = generateToken({
    id: employee.id,
    email: employee.email,
    role: employee.role,
    companyId: employee.companyId,
  });
  const submitRes = await fetch(`${fx.baseUrl}/api/attendance/exceptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({
      exceptionDate: workDate,
      type: "forgotten_clock_out",
      reason:
        "I forgot to clock out at the end of my shift. [Original In: 09:00, Corrected In: 09:00, Corrected Out: 17:00]",
      punchLogId: openPunch.id,
    }),
  });
  const submitBody = await submitRes.text();
  assert.equal(
    submitRes.status,
    201,
    `expected 201 from POST /api/attendance/exceptions, got ${submitRes.status} (${submitBody})`,
  );
  const created = JSON.parse(submitBody);
  assert.equal(created.type, "forgotten_clock_out", "exception should be stored as forgotten_clock_out");
  assert.equal(created.punchLogId, openPunch.id, "exception should carry the open punch FK");

  // Approve it, routing the requested clock-out through correctedTime as the
  // Requests & Approvals page now does for forgotten_clock_out.
  const resolveRes = await fetch(`${fx.baseUrl}/api/attendance/exceptions/${created.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fx.reviewerToken}`,
    },
    body: JSON.stringify({
      action: "approve",
      reviewNotes: "closing the open shift",
      correctedTime: correctedClockOutAt.toISOString(),
    }),
  });
  assert.equal(
    resolveRes.status,
    200,
    `expected 200 from resolve route, got ${resolveRes.status} (${await resolveRes.text().catch(() => "")})`,
  );

  // The crux of BUG-0246: exactly ONE punch must exist for this date.
  const punchesForDate = await db
    .select()
    .from(punchLogs)
    .where(and(eq(punchLogs.employeeId, fx.employeeId), eq(punchLogs.workDate, workDate)));
  assert.equal(
    punchesForDate.length,
    1,
    `expected exactly one punch for ${workDate} (no duplicate), found ${punchesForDate.length}`,
  );

  // …and it must be the original punch, now closed with the corrected time.
  const [updatedPunch] = punchesForDate;
  assert.equal(updatedPunch.id, openPunch.id, "the existing punch must be the one that was updated");
  assert.ok(updatedPunch.clockOut, "clockOut should be filled in");
  assert.equal(
    new Date(updatedPunch.clockOut!).getTime(),
    correctedClockOutAt.getTime(),
    "clockOut should reflect the employee's requested time, not 'now'",
  );
  assert.equal(updatedPunch.hoursWorked, 8, "hoursWorked should be recomputed for the 9am–5pm shift");
  assert.notEqual(updatedPunch.status, "in-progress", "the punch should no longer be open");

  const [resolvedException] = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.id, created.id));
  assert.equal(resolvedException.status, "approved");
  assert.equal(resolvedException.punchLogId, openPunch.id);
});

test("POST /attendance/exceptions: a missing_punch approval (no existing punch) still INSERTS a new punch", async (t) => {
  const fx = await setupFixture("missing-punch-still-inserts");
  t.after(fx.cleanup);

  // No punch exists for this date — a genuine missing-punch request.
  const workDate = "2026-05-05";
  const clockInAt = new Date("2026-05-05T08:00:00Z");

  const before = await db
    .select()
    .from(punchLogs)
    .where(and(eq(punchLogs.employeeId, fx.employeeId), eq(punchLogs.workDate, workDate)));
  assert.equal(before.length, 0, "precondition: no punch should exist for this date");

  const [exception] = await db
    .insert(attendanceExceptions)
    .values({
      employeeId: fx.employeeId,
      exceptionDate: workDate,
      exceptionTime: clockInAt,
      type: "missing_punch",
      reason: "I never clocked in. [Corrected In: 08:00]",
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
      correctedTime: clockInAt.toISOString(),
    }),
  });
  assert.equal(res.status, 200, `expected 200 from resolve route, got ${res.status}`);

  const after = await db
    .select()
    .from(punchLogs)
    .where(and(eq(punchLogs.employeeId, fx.employeeId), eq(punchLogs.workDate, workDate)));
  assert.equal(after.length, 1, "a genuine missing_punch approval should INSERT exactly one new punch");
  assert.equal(
    new Date(after[0].clockIn!).getTime(),
    clockInAt.getTime(),
    "the new punch should use the corrected clock-in time",
  );
});
