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
import { eq, sql } from "drizzle-orm";

const REVIEWER_ID = "admin-dev-001";
const EMAIL_PREFIX = "punchintegrity-test+";

type Fixture = {
  baseUrl: string;
  reviewerToken: string;
  employeeId: string;
  employeeToken: string;
  cleanup: () => Promise<void>;
};

async function removeFixtureUser(userId: string) {
  // Clock-out refreshes the ledger in the background. Lock the parent first so
  // an in-flight FK insert finishes before cleanup or waits until deletion.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    await tx.delete(systemAlerts).where(eq(systemAlerts.employeeId, userId));
    await tx.delete(attendanceExceptions).where(eq(attendanceExceptions.employeeId, userId));
    await tx.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, userId));
    await tx.delete(punchLogs).where(eq(punchLogs.employeeId, userId));
    await tx.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

async function purgeLeftovers() {
  const all = await db.select().from(users);
  const stale = all.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  for (const u of stale) await removeFixtureUser(u.id);
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
    try {
      await removeFixtureUser(employee.id);
    } finally {
      // A cleanup assertion must never leave a listening server and hang CI.
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
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
  body: { clockIn?: string | null; clockOut?: string | null; workDate?: string; reason?: string },
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

// --- Manager "add a missing punch" via POST /api/attendance/punches ---------

async function createPunch(
  fx: Fixture,
  body: { employeeId?: string; clockIn?: string | null; clockOut?: string | null; reason?: string },
) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fx.reviewerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const resBody = await res.json().catch(() => ({}));
  return { status: res.status, body: resBody };
}

test("add punch accepted: creates the row and computes hours", async (t) => {
  const fx = await setupFixture("addvalid");
  t.after(fx.cleanup);

  const workDate = "2026-01-09";
  const { status, body } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: `${workDate}T09:00:00Z`,
    clockOut: `${workDate}T17:00:00Z`,
    reason: "forgot to clock in",
  });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1, "exactly one punch created");
  assert.equal(Number(rows[0].hoursWorked), 8, "hours computed by the shared enforcement");
  assert.ok(rows[0].clockOut, "clock-out persisted");
  assert.equal(rows[0].workDate, workDate);
});

test("add punch accepted: clock-out only (missing clock-in) is in-progress with no hours", async (t) => {
  const fx = await setupFixture("addnocin");
  t.after(fx.cleanup);

  // A manager recording the time an employee left when the clock-in is unknown.
  // The mirror of an open punch: the clock-out is kept, the clock-in stays a
  // missing punch, and hours are left unresolved until it's filled in.
  const { status, body } = await createPunch(fx, { employeeId: fx.employeeId, clockOut: "2026-01-09T17:00:00Z" });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1, "exactly one punch created");
  assert.equal(rows[0].clockIn, null, "clock-in left missing");
  assert.ok(rows[0].clockOut, "clock-out persisted");
  assert.equal(rows[0].hoursWorked, null, "hours unresolved without a clock-in");
});

test("add punch rejected: neither clock-in nor clock-out (400)", async (t) => {
  const fx = await setupFixture("addnoeither");
  t.after(fx.cleanup);

  const { status } = await createPunch(fx, { employeeId: fx.employeeId });
  assert.equal(status, 400);
});

test("add punch rejected: overlaps an existing punch (400)", async (t) => {
  const fx = await setupFixture("addoverlap");
  t.after(fx.cleanup);

  const workDate = "2026-01-10";
  await makePunch(fx.employeeId, workDate, `${workDate}T08:00:00Z`, `${workDate}T12:00:00Z`, 4);

  const { status, body } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: `${workDate}T11:00:00Z`,
    clockOut: `${workDate}T15:00:00Z`,
  });
  assert.equal(status, 400);
  assert.match(String(body.message), /overlap/i);

  // No extra punch persisted.
  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1, "overlapping add did not create a row");
});

test("add punch (open, no clock-out) is created in-progress", async (t) => {
  const fx = await setupFixture("addopen");
  t.after(fx.cleanup);

  const workDate = "2026-01-11";
  const { status } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: `${workDate}T09:00:00Z`,
  });
  assert.equal(status, 201);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clockOut, null, "left open");
  assert.equal(rows[0].status, "in-progress");
});

test("back-fill: a clock-in-only add while a shift is in progress is recorded as a missing punch (not rejected)", async (t) => {
  const fx = await setupFixture("backfill");
  t.after(fx.cleanup);

  // Employee is clocked in NOW (a live, open shift).
  const liveIn = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago, still open
  const liveId = await makePunch(fx.employeeId, liveIn.toISOString().slice(0, 10), liveIn.toISOString(), null, null);

  // Manager back-fills yesterday's forgotten clock-in (no clock-out yet).
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ymd = yesterday.toISOString().slice(0, 10);
  const { status, body } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: `${ymd}T09:00:00Z`,
  });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  // The back-filled punch is a flagged missing-clock-out (no hours), NOT a
  // second open shift — and it did not disturb the live shift.
  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 2, "both punches exist");
  const backfilled = rows.find((r) => r.id !== liveId)!;
  assert.equal(backfilled.status, "missing_clockout", "back-fill marked missing_clockout");
  assert.equal(backfilled.hoursWorked, 0, "no hours until the real clock-out is entered");
  assert.ok(backfilled.clockIn, "clock-in preserved");

  // The live shift is still open and untouched (status unchanged from setup).
  const live = await storage.getPunchLog(liveId);
  assert.equal(live?.clockOut, null, "live shift still open");
  assert.equal(live?.status, "present", "live shift untouched");
});

test("edit can move a punch to a different work date (fix a UTC-rolled day)", async (t) => {
  const fx = await setupFixture("moveday");
  t.after(fx.cleanup);

  // Simulate the real bug: a 11/2 evening Eastern shift filed under 11/3 (UTC).
  // clockIn is a real instant (01:00Z on the 3rd); workDate wrongly shows the 3rd.
  const punchId = await makePunch(fx.employeeId, "2026-11-03", "2026-11-03T01:00:00Z", "2026-11-03T05:00:00Z", 4);

  const { status } = await editPunch(fx, punchId, { workDate: "2026-11-02", reason: "evening shift belongs to 11/2" });
  assert.equal(status, 200);

  const after = await storage.getPunchLog(punchId);
  assert.equal(after?.workDate, "2026-11-02", "work date moved to the correct local day");
  // Times and hours are untouched by a pure day move.
  assert.equal(Number(after?.hoursWorked), 4);
  assert.ok(after?.clockIn, "clock-in preserved");
});

test("edit rejects an invalid work date", async (t) => {
  const fx = await setupFixture("movebadday");
  t.after(fx.cleanup);

  const punchId = await makePunch(fx.employeeId, "2026-11-03", "2026-11-03T01:00:00Z", "2026-11-03T05:00:00Z", 4);
  const { status } = await editPunch(fx, punchId, { workDate: "11/02/2026" } as any);
  assert.equal(status, 400);
});
