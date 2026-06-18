/**
 * End-to-end coverage for the shared punch-integrity validator wired into the
 * manager punch-edit route `PATCH /api/attendance/punches/:id` (task #450).
 *
 * Runs through the real Express route + real auth so the production guard is
 * exercised, not a re-implementation. Covers:
 *   - clock-out before clock-in  -> 400 (rejected)
 *   - future-dated clock-out     -> 400 (rejected)
 *   - overlap with another punch -> 400 (rejected)
 *   - a valid edit               -> 200 AND hours are recomputed
 *
 * Mirrors the registerRoutes fixture pattern from payrollLockedPeriod.test.ts.
 *
 * Run with: `npx tsx server/__tests__/punchIntegrityRoute.test.ts`  (requires DATABASE_URL)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "../db";
import { storage } from "../storage";
import { registerRoutes } from "../routes";
import { generateToken } from "../middleware/auth";
import { users, punchLogs, attendanceLedger, attendanceChangeLedger, attendanceExceptions, systemAlerts } from "@shared/schema";
import { eq } from "drizzle-orm";

const REVIEWER_ID = "admin-dev-001";
const EMAIL_PREFIX = "punchintegrity-test+";

type Fixture = {
  baseUrl: string;
  reviewerToken: string;
  employeeId: string;
  employeeToken: string;
  cleanup: () => Promise<void>;
};

async function purgeLeftovers() {
  const all = await db.select().from(users);
  const stale = all.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  for (const u of stale) {
    await db.delete(systemAlerts).where(eq(systemAlerts.employeeId, u.id));
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, u.id));
    await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, u.id));
    await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, u.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
}

async function setupFixture(label: string): Promise<Fixture> {
  await purgeLeftovers();

  const app = express();
  app.use(express.json());
  const httpServer = http.createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const reviewer = await storage.getUser(REVIEWER_ID);
  assert.ok(reviewer, "expected seeded admin-dev-001 user");
  const reviewerToken = generateToken({
    id: reviewer.id,
    email: reviewer.email,
    role: reviewer.role,
    companyId: reviewer.companyId,
  });

  const [employee] = await db
    .insert(users)
    .values({
      email: `${EMAIL_PREFIX}${label}@example.invalid`,
      firstName: "Punch",
      lastName: "Integrity",
      role: "employee",
      companyId: reviewer.companyId,
    })
    .returning();

  const employeeToken = generateToken({
    id: employee.id,
    email: employee.email,
    role: employee.role,
    companyId: employee.companyId,
  });

  const cleanup = async () => {
    await db.delete(systemAlerts).where(eq(systemAlerts.employeeId, employee.id));
    await db.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, employee.id));
    await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, employee.id));
    await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, employee.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, employee.id));
    await db.delete(users).where(eq(users.id, employee.id));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { baseUrl, reviewerToken, employeeId: employee.id, employeeToken, cleanup };
}

async function makePunch(
  employeeId: string,
  workDate: string,
  clockInIso: string,
  clockOutIso: string | null,
  hoursWorked: number | null,
) {
  const [punch] = await db
    .insert(punchLogs)
    .values({
      employeeId,
      workDate,
      clockIn: new Date(clockInIso),
      clockOut: clockOutIso ? new Date(clockOutIso) : null,
      hoursWorked,
      status: clockOutIso ? "complete" : "present",
      source: "test",
      approved: true,
    })
    .returning();
  return punch.id;
}

async function editPunch(
  fx: Fixture,
  punchId: string,
  body: { clockIn?: string | null; clockOut?: string | null; reason?: string },
) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punches/${punchId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${fx.reviewerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const resBody = await res.json().catch(() => ({}));
  return { status: res.status, body: resBody };
}

test("edit rejected: clock-out before clock-in (400)", async (t) => {
  const fx = await setupFixture("negative");
  t.after(fx.cleanup);

  const workDate = "2026-01-05";
  const punchId = await makePunch(
    fx.employeeId,
    workDate,
    `${workDate}T09:00:00Z`,
    `${workDate}T17:00:00Z`,
    8,
  );

  const { status, body } = await editPunch(fx, punchId, {
    clockIn: `${workDate}T17:00:00Z`,
    clockOut: `${workDate}T09:00:00Z`,
    reason: "test",
  });
  assert.equal(status, 400);
  assert.match(String(body.message), /after clock-in/i);

  // Punch must be unchanged.
  const after = await storage.getPunchLog(punchId);
  assert.equal(Number(after?.hoursWorked), 8);
});

test("edit rejected: future-dated clock-out (400)", async (t) => {
  const fx = await setupFixture("future");
  t.after(fx.cleanup);

  const workDate = "2026-01-06";
  const punchId = await makePunch(
    fx.employeeId,
    workDate,
    `${workDate}T09:00:00Z`,
    `${workDate}T17:00:00Z`,
    8,
  );

  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { status, body } = await editPunch(fx, punchId, {
    clockOut: future,
    reason: "test",
  });
  assert.equal(status, 400);
  assert.match(String(body.message), /future/i);
});

test("edit rejected: overlap with another of the employee's punches (400)", async (t) => {
  const fx = await setupFixture("overlap");
  t.after(fx.cleanup);

  const workDate = "2026-01-07";
  // Existing morning shift on the same day.
  await makePunch(
    fx.employeeId,
    workDate,
    `${workDate}T08:00:00Z`,
    `${workDate}T12:00:00Z`,
    4,
  );
  // The punch we edit — afternoon shift.
  const punchId = await makePunch(
    fx.employeeId,
    workDate,
    `${workDate}T13:00:00Z`,
    `${workDate}T17:00:00Z`,
    4,
  );

  // Move its clock-in back into the morning shift -> overlap.
  const { status, body } = await editPunch(fx, punchId, {
    clockIn: `${workDate}T11:00:00Z`,
    clockOut: `${workDate}T17:00:00Z`,
    reason: "test",
  });
  assert.equal(status, 400);
  assert.match(String(body.message), /overlap/i);
});

test("edit accepted: valid times update the punch AND recompute hours", async (t) => {
  const fx = await setupFixture("recalc");
  t.after(fx.cleanup);

  const workDate = "2026-01-08";
  const punchId = await makePunch(
    fx.employeeId,
    workDate,
    `${workDate}T09:00:00Z`,
    `${workDate}T13:00:00Z`,
    4,
  );

  // Extend the shift to 8 hours.
  const { status, body } = await editPunch(fx, punchId, {
    clockIn: `${workDate}T09:00:00Z`,
    clockOut: `${workDate}T17:00:00Z`,
    reason: "test",
  });
  assert.equal(status, 200);

  const after = await storage.getPunchLog(punchId);
  assert.ok(after?.clockOut, "clock-out persisted");
  // Hours must have been recomputed from 4 -> 8 by the edit path.
  assert.equal(Number(after?.hoursWorked), 8);
  assert.equal(Number(body.totalHours), 8);
});

async function clockOut(fx: Fixture) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/clock-out`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fx.employeeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "web" }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// --- Task #482: clock-out must succeed even when the close overlaps another
// shift, and must raise a manager-facing punch_overlap exception + alert. ------

test("clock-out NOT blocked by an overlapping shift: close recorded + overlap flagged", async (t) => {
  const fx = await setupFixture("clockoutoverlap");
  t.after(fx.cleanup);

  // Build the real-world case relative to NOW so the close isn't future-dated:
  // a closed shift, plus an open punch starting inside it.
  const now = Date.now();
  const closedIn = new Date(now - 2 * 60 * 60 * 1000); // 2h ago
  const closedOut = new Date(now - 30 * 60 * 1000); // 30m ago
  const openIn = new Date(now - 60 * 60 * 1000); // 1h ago — inside the closed shift
  const workDate = new Date(now).toISOString().split("T")[0];

  // The earlier closed shift.
  const closedId = await makePunch(
    fx.employeeId,
    workDate,
    closedIn.toISOString(),
    closedOut.toISOString(),
    1.5,
  );
  // The currently-open punch that overlaps the closed shift.
  const openId = await makePunch(
    fx.employeeId,
    workDate,
    openIn.toISOString(),
    null,
    null,
  );

  const { status } = await clockOut(fx);
  // The clock-out must SUCCEED — the employee is never trapped clocked in.
  assert.equal(status, 200);

  // The open punch is now closed.
  const closed = await storage.getPunchLog(openId);
  assert.ok(closed?.clockOut, "the open punch was closed");

  // A manager-facing punch_overlap exception was raised, linked to the punch.
  const exceptions = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.employeeId, fx.employeeId));
  const overlapEx = exceptions.find((e) => e.type === "punch_overlap");
  assert.ok(overlapEx, "expected a punch_overlap exception");
  assert.equal(overlapEx!.status, "pending");
  assert.equal(overlapEx!.punchLogId, openId);

  // And a system alert.
  const alerts = await db
    .select()
    .from(systemAlerts)
    .where(eq(systemAlerts.employeeId, fx.employeeId));
  assert.ok(
    alerts.some((a) => a.type === "punch_overlap"),
    "expected a punch_overlap system alert",
  );

  // The unrelated closed shift is untouched.
  const stillClosed = await storage.getPunchLog(closedId);
  assert.ok(stillClosed, "closed shift still present");
});

test("clock-out with no overlap does NOT raise an exception", async (t) => {
  const fx = await setupFixture("clockoutclean");
  t.after(fx.cleanup);

  const now = Date.now();
  const openIn = new Date(now - 60 * 60 * 1000); // 1h ago
  const workDate = new Date(now).toISOString().split("T")[0];

  await makePunch(fx.employeeId, workDate, openIn.toISOString(), null, null);

  const { status } = await clockOut(fx);
  assert.equal(status, 200);

  const exceptions = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.employeeId, fx.employeeId));
  assert.ok(
    !exceptions.some((e) => e.type === "punch_overlap"),
    "no punch_overlap exception should be raised for a clean clock-out",
  );
});
