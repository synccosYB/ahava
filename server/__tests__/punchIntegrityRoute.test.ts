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

test("add punch accepted: clock-out only (missing clock-in) is a MISSING PUNCH, not in-progress", async (t) => {
  const fx = await setupFixture("addnocin");
  t.after(fx.cleanup);

  // A manager recording the time an employee left when the clock-in is unknown.
  // The clock-out is kept, the clock-in is a missing punch, hours unresolved.
  const { status, body } = await createPunch(fx, { employeeId: fx.employeeId, clockOut: "2026-01-09T17:00:00Z" });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1, "exactly one punch created");
  assert.equal(rows[0].clockIn, null, "clock-in left missing");
  assert.ok(rows[0].clockOut, "clock-out persisted");
  assert.equal(rows[0].hoursWorked, null, "hours unresolved without a clock-in");
  assert.equal(rows[0].status, "missing_clockin", "flagged as a missing punch (missing clock-in), not in-progress");

  // It's surfaced as a missing-punch review exception.
  const flags = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.employeeId, fx.employeeId));
  assert.ok(flags.some((f) => f.type === "missing_clockin"), "a missing_clockin exception was raised");
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

test("back-fill: a clock-in-only add for a PRIOR day is a missing punch even when a LATER shift is already completed (no overlap)", async (t) => {
  const fx = await setupFixture("backfillprior");
  t.after(fx.cleanup);

  // Grajalas's case: already clocked IN and OUT on 11/4 (a completed shift).
  const laterId = await makePunch(fx.employeeId, "2026-11-04", "2026-11-04T13:10:00Z", "2026-11-04T21:02:00Z", 7.87);

  // Manager back-fills the forgotten 11/3 clock-in (no clock-out).
  const { status, body } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: "2026-11-03T13:09:00Z",
  });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 2, "both punches exist");
  const backfilled = rows.find((r) => r.id !== laterId)!;
  assert.equal(backfilled.status, "missing_clockout", "prior-day back-fill marked missing_clockout");
  assert.equal(backfilled.hoursWorked, 0, "no hours");
  // Its placeholder clock-out must land before the later shift starts (no overlap).
  assert.ok(
    new Date(backfilled.clockOut as any).getTime() < new Date("2026-11-04T13:10:00Z").getTime(),
    "placeholder clock-out does not reach into the later shift",
  );

  // The later completed shift is untouched.
  const later = await storage.getPunchLog(laterId);
  assert.equal(Number(later?.hoursWorked), 7.87, "later shift hours untouched");
});

test("add a LATER clock-in when an EARLIER shift is still open: the stale shift is capped as a missing punch and the new clock-in opens a separate shift (not rejected)", async (t) => {
  const fx = await setupFixture("latershift");
  t.after(fx.cleanup);

  // Nov 4: clocked in 9:32 AM, no clock-out entered yet — an OPEN shift that is
  // really a forgotten punch-out (the manager's exact situation).
  const staleId = await makePunch(
    fx.employeeId,
    "2026-11-04",
    "2026-11-04T14:32:00Z",
    null,
    null,
  );

  // Nov 5: the manager adds the next day's clock-in (9:52 AM, no clock-out).
  // Previously rejected as overlapping the still-open Nov 4 shift.
  const { status, body } = await createPunch(fx, {
    employeeId: fx.employeeId,
    clockIn: "2026-11-05T14:52:00Z",
  });
  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 2, "both shifts exist (the new one was not rejected)");

  // The earlier Nov 4 shift is now a flagged missing punch (0 hours), with a
  // placeholder clock-out before the Nov 5 clock-in (so no overlap).
  const stale = rows.find((r) => r.id === staleId)!;
  assert.equal(stale.status, "missing_clockout", "earlier open shift capped as missing_clockout");
  assert.equal(stale.hoursWorked, 0, "no hours on the missing punch");
  assert.ok(stale.clockOut, "earlier shift left the open slot (placeholder clock-out)");
  assert.ok(
    new Date(stale.clockOut as any).getTime() < new Date("2026-11-05T14:52:00Z").getTime(),
    "placeholder clock-out lands before the new day's clock-in (no overlap)",
  );

  // The Nov 5 punch is a NORMAL open shift (in-progress), not a missing punch.
  const fresh = rows.find((r) => r.id !== staleId)!;
  assert.equal(fresh.status, "in-progress", "the new day's clock-in is a normal open shift");
  assert.equal(fresh.clockOut, null, "new shift is open, awaiting its clock-out");

  // The stale shift is surfaced for manager review.
  const flags = await db
    .select()
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.employeeId, fx.employeeId));
  assert.ok(
    flags.some((f) => f.type === "missing_clockout" && f.punchLogId === staleId),
    "a missing_clockout exception was raised for the earlier shift",
  );
});

async function makeClockIn(fx: Fixture, punchId: string) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punches/${punchId}/make-clockin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fx.reviewerToken}`, "Content-Type": "application/json" },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("make-clockin (split): a punch recorded as a clock-out becomes a new clock-in; the prior part is a missing punch", async (t) => {
  const fx = await setupFixture("mkclockin");
  t.after(fx.cleanup);

  // A shift whose clock-out is really the next morning's arrival (a mis-toggle).
  const priorId = await makePunch(fx.employeeId, "2026-11-04", "2026-11-04T14:00:00Z", "2026-11-05T13:41:00Z", 23.6);

  const { status, body } = await makeClockIn(fx, priorId);
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.mode, "split");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 2, "prior shift + a new open shift");

  const prior = rows.find((r) => r.id === priorId)!;
  assert.equal(prior.status, "missing_clockout", "prior shift is now a missing punch");
  assert.equal(Number(prior.hoursWorked), 0, "no hours on the prior missing punch");
  const tap = new Date("2026-11-05T13:41:00Z").getTime();
  assert.ok(new Date(prior.clockOut as any).getTime() < tap, "prior placeholder ends before the new clock-in");

  const fresh = rows.find((r) => r.id !== priorId)!;
  assert.equal(new Date(fresh.clockIn as any).getTime(), tap, "new shift opens at the former clock-out tap");
  assert.equal(fresh.clockOut, null, "new shift is open");
  assert.equal(fresh.status, "in-progress");
});

test("make-clockin (flip): a clock-out-only punch (missing clock-in) flips to an open clock-in", async (t) => {
  const fx = await setupFixture("mkflip");
  t.after(fx.cleanup);

  // A clock-out-only punch (no clock-in recorded).
  const [p] = await db.insert(punchLogs).values({
    employeeId: fx.employeeId, workDate: "2026-11-05",
    clockIn: null, clockOut: new Date("2026-11-05T13:41:00Z"),
    roundedClockOut: new Date("2026-11-05T13:41:00Z"),
    hoursWorked: null, status: "in-progress", source: "manager", approved: true,
  }).returning();

  const { status, body } = await makeClockIn(fx, p.id);
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.mode, "flipped");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 1, "still one punch (flipped in place)");
  assert.equal(new Date(rows[0].clockIn as any).getTime(), new Date("2026-11-05T13:41:00Z").getTime(), "clock-in set to the tap");
  assert.equal(rows[0].clockOut, null, "clock-out cleared (now an open shift)");
  assert.equal(rows[0].status, "in-progress");
});

async function getChangeMarks(fx: Fixture, employeeId: string, token?: string) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punch-change-marks?employeeId=${employeeId}`, {
    headers: { Authorization: `Bearer ${token ?? fx.reviewerToken}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("punch-change-marks: an edited clock time is reported with its previous value, who, and when", async (t) => {
  const fx = await setupFixture("changemarks");
  t.after(fx.cleanup);

  const wd = "2026-01-20";
  const punchId = await makePunch(fx.employeeId, wd, `${wd}T09:00:00Z`, `${wd}T17:00:00Z`, 8);

  // Edit the clock-out from 17:00 to 17:30 (clock-in unchanged).
  const { status: es } = await editPunch(fx, punchId, { clockIn: `${wd}T09:00:00Z`, clockOut: `${wd}T17:30:00Z`, reason: "fix out" });
  assert.equal(es, 200);

  const { status, body } = await getChangeMarks(fx, fx.employeeId);
  assert.equal(status, 200, JSON.stringify(body));
  const mark = body.marks?.[punchId];
  assert.ok(mark, "a change mark exists for the edited punch");
  assert.ok(mark.clockOut, "the clock-out change is recorded");
  assert.equal(new Date(mark.clockOut.from).getTime(), new Date(`${wd}T17:00:00Z`).getTime(), "'from' is the original clock-out");
  assert.ok(mark.clockOut.by && mark.clockOut.by !== "System", "records who changed it");
  assert.ok(mark.clockOut.at, "records when it was changed");
  assert.ok(!mark.clockIn, "clock-in was not changed → no clock-in mark");
});

test("punch-change-marks: a non-admin/manager is forbidden", async (t) => {
  const fx = await setupFixture("changemarksauth");
  t.after(fx.cleanup);
  const res = await fetch(`${fx.baseUrl}/api/attendance/punch-change-marks?employeeId=${fx.employeeId}`, {
    headers: { Authorization: `Bearer ${fx.employeeToken}` },
  });
  assert.equal(res.status, 403, "employees can't see who changed times");
});

test("punch-change-marks respects a manager's attendance scope", async (t) => {
  const fx = await setupFixture("changemarksscope");
  t.after(fx.cleanup);

  const employee = await storage.getUser(fx.employeeId);
  assert.ok(employee);
  const [manager] = await db.insert(users).values({
    email: `${EMAIL_PREFIX}changemarksscope-manager@example.invalid`,
    firstName: "Punch",
    lastName: "Manager",
    role: "manager",
    companyId: employee.companyId,
  }).returning();
  t.after(() => removeFixtureUser(manager.id));

  const managerToken = generateToken({
    id: manager.id,
    email: manager.email,
    role: manager.role,
    companyId: manager.companyId,
  });
  const own = await getChangeMarks(fx, manager.id, managerToken);
  assert.equal(own.status, 200, "the manager can view punch changes within their scope");
  const outside = await getChangeMarks(fx, employee.id, managerToken);
  assert.equal(outside.status, 403, "the manager cannot view punch changes for an unassigned employee");
});

test("edit: removing the clock-out while another shift is open records a MISSING PUNCH (not a duplicate-open error)", async (t) => {
  const fx = await setupFixture("editremoveout");
  t.after(fx.cleanup);

  // A live open shift (today).
  const openIn = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const openId = await makePunch(fx.employeeId, openIn.toISOString().slice(0, 10), openIn.toISOString(), null, null);

  // An earlier CLOSED shift; clearing its clock-out would otherwise be blocked
  // as a second open shift.
  const closedId = await makePunch(fx.employeeId, "2026-02-10", "2026-02-10T09:00:00Z", "2026-02-10T17:00:00Z", 8);

  const { status, body } = await editPunch(fx, closedId, { clockOut: null, reason: "forgot to clock out" });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);

  const closed = await storage.getPunchLog(closedId);
  assert.equal(closed?.status, "missing_clockout", "cleared-out punch becomes a missing punch");
  assert.equal(Number(closed?.hoursWorked), 0, "no hours on the missing punch");
  assert.ok(closed?.clockOut, "has a placeholder clock-out so the one-open slot stays free");
  assert.ok(closed?.clockIn, "clock-in preserved");

  // The live open shift is untouched.
  const open = await storage.getPunchLog(openId);
  assert.equal(open?.clockOut, null, "the live open shift is still open");
});

test("edit: removing the clock-out with no other open shift re-opens the punch (in-progress)", async (t) => {
  const fx = await setupFixture("editreopen");
  t.after(fx.cleanup);

  const closedId = await makePunch(fx.employeeId, "2026-02-11", "2026-02-11T09:00:00Z", "2026-02-11T17:00:00Z", 8);
  const { status } = await editPunch(fx, closedId, { clockOut: null, reason: "reopen" });
  assert.equal(status, 200);

  const p = await storage.getPunchLog(closedId);
  assert.equal(p?.clockOut, null, "re-opened (no placeholder) when nothing collides");
  assert.equal(p?.status, "in-progress");
});

async function resolveLongShift(fx: Fixture, punchId: string, action: "approve" | "reject") {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punches/${punchId}/resolve-long-shift`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fx.reviewerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("B3: clocking out a 14h shift is held PENDING APPROVAL (not auto-counted)", async (t) => {
  const fx = await setupFixture("b3pending");
  t.after(fx.cleanup);

  // Open shift that started 14h ago (in the 13–16h approval band).
  const inIso = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();
  await makePunch(fx.employeeId, inIso.slice(0, 10), inIso, null, null);

  const closed = await storage.clockOut(fx.employeeId);
  assert.ok(closed, "clock-out recorded");
  assert.equal(closed!.status, "pending_approval", "held for approval");
  assert.ok(Number(closed!.hoursWorked) > 13 && Number(closed!.hoursWorked) < 16, "hours in the 13–16h band");

  const flags = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.employeeId, fx.employeeId));
  assert.ok(flags.some((f) => f.type === "long_shift_approval"), "a long_shift_approval review item was raised");
});

test("B3: approving a pending long shift keeps it as a real clock-out (hours count)", async (t) => {
  const fx = await setupFixture("b3approve");
  t.after(fx.cleanup);

  const cin = new Date("2026-03-02T09:00:00Z");
  const cout = new Date(cin.getTime() + 14 * 3600 * 1000);
  const [p] = await db.insert(punchLogs).values({
    employeeId: fx.employeeId, workDate: "2026-03-02", clockIn: cin, clockOut: cout,
    roundedClockIn: cin, roundedClockOut: cout, hoursWorked: 14, status: "pending_approval",
    source: "biometric", approved: true,
  }).returning();

  const { status, body } = await resolveLongShift(fx, p.id, "approve");
  assert.equal(status, 200, JSON.stringify(body));
  const after = await storage.getPunchLog(p.id);
  assert.notEqual(after!.status, "pending_approval", "no longer pending");
  assert.notEqual(after!.status, "missing_clockout", "kept, not zeroed");
  assert.equal(Number(after!.hoursWorked), 14, "hours kept");
});

test("B3: rejecting a pending long shift makes it a missing punch and opens a fresh shift at the clock-out", async (t) => {
  const fx = await setupFixture("b3reject");
  t.after(fx.cleanup);

  const cin = new Date("2026-03-03T09:00:00Z");
  const cout = new Date(cin.getTime() + 14 * 3600 * 1000);
  const [p] = await db.insert(punchLogs).values({
    employeeId: fx.employeeId, workDate: "2026-03-03", clockIn: cin, clockOut: cout,
    roundedClockIn: cin, roundedClockOut: cout, hoursWorked: 14, status: "pending_approval",
    source: "biometric", approved: true,
  }).returning();

  const { status, body } = await resolveLongShift(fx, p.id, "reject");
  assert.equal(status, 200, JSON.stringify(body));

  const prior = await storage.getPunchLog(p.id);
  assert.equal(prior!.status, "missing_clockout", "original shift is now a missing punch");
  assert.equal(Number(prior!.hoursWorked), 0, "no hours");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, fx.employeeId));
  assert.equal(rows.length, 2, "a fresh shift was opened");
  const fresh = rows.find((r) => r.id !== p.id)!;
  assert.equal(new Date(fresh.clockIn as any).getTime(), cout.getTime(), "new shift opens at the clock-out time");
  assert.equal(fresh.clockOut, null, "new shift is open");
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
