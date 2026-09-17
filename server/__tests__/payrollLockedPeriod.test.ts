/**
 * Locked-period (finalized-payroll) edit-blocking coverage — end-to-end through
 * the real Express route + real auth, so the production guard is exercised, not a
 * re-implementation of it.
 *
 * The guard under test: `DELETE /api/attendance/punches/:id` must refuse to delete
 * a punch that belongs to a FINALIZED payroll batch (status `exported` or
 * `locked`), returning HTTP 409 with code `PAYROLL_FINALIZED`
 * (server/routes.ts → findFinalizedPayrollExportsForPunch). A punch tied only to a
 * `draft` export must still be deletable.
 *
 * Mirrors the registerRoutes fixture pattern used by exceptionResolveRoute.test.ts.
 *
 * Run with: `npx tsx server/__tests__/payrollLockedPeriod.test.ts`  (requires DATABASE_URL)
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
import {
  users,
  punchLogs,
  payrollExports,
  payrollBatchRecords,
  attendanceChangeLedger,
  attendanceLedger,
} from "@shared/schema";
import { eq, inArray, or } from "drizzle-orm";

// The ledger tables reference users(id) with no ON DELETE CASCADE, and the
// delete-punch route writes an attendance_change_ledger audit row, so any test
// user must have its ledger rows purged before it can be deleted.
async function purgeLedgerFor(userId: string) {
  await db
    .delete(attendanceChangeLedger)
    .where(or(eq(attendanceChangeLedger.employeeId, userId), eq(attendanceChangeLedger.actorUserId, userId)));
  await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, userId));
}

const REVIEWER_ID = "admin-dev-001";
const EMAIL_PREFIX = "lockedperiod-test+";

type Fixture = {
  baseUrl: string;
  reviewerToken: string;
  employeeId: string;
  cleanup: () => Promise<void>;
};

async function purgeLeftovers() {
  const all = await db.select().from(users);
  const stale = all.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  for (const u of stale) {
    const exps = await db
      .select()
      .from(payrollExports)
      .where(eq(payrollExports.createdBy, u.id));
    const expIds = exps.map((e) => e.id);
    if (expIds.length) {
      await db
        .delete(payrollBatchRecords)
        .where(inArray(payrollBatchRecords.payrollExportId, expIds));
      await db.delete(payrollExports).where(inArray(payrollExports.id, expIds));
    }
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.employeeId, u.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, u.id));
    await purgeLedgerFor(u.id);
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
      firstName: "Locked",
      lastName: "Period",
      role: "employee",
      companyId: reviewer.companyId,
    })
    .returning();

  const createdExportIds: string[] = [];
  const cleanup = async () => {
    if (createdExportIds.length) {
      await db
        .delete(payrollBatchRecords)
        .where(inArray(payrollBatchRecords.payrollExportId, createdExportIds));
      await db.delete(payrollExports).where(inArray(payrollExports.id, createdExportIds));
    }
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.employeeId, employee.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, employee.id));
    await purgeLedgerFor(employee.id);
    await db.delete(users).where(eq(users.id, employee.id));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  // Expose the created-export tracker via closure for the helpers below.
  (cleanup as any).track = (id: string) => createdExportIds.push(id);

  return { baseUrl, reviewerToken, employeeId: employee.id, cleanup };
}

async function makePunch(employeeId: string, workDate: string) {
  const [punch] = await db
    .insert(punchLogs)
    .values({
      employeeId,
      workDate,
      clockIn: new Date(`${workDate}T09:00:00Z`),
      clockOut: new Date(`${workDate}T17:00:00Z`),
      hoursWorked: 8,
      status: "complete",
      source: "test",
      approved: true,
    })
    .returning();
  return punch.id;
}

async function makeExportWithPunch(
  reviewerId: string,
  employeeId: string,
  punchId: string,
  workDate: string,
  status: "draft" | "exported" | "locked",
  track: (id: string) => void,
) {
  const [exp] = await db
    .insert(payrollExports)
    .values({
      startDate: workDate,
      endDate: workDate,
      status,
      createdBy: reviewerId,
    })
    .returning();
  track(exp.id);
  await db.insert(payrollBatchRecords).values({
    payrollExportId: exp.id,
    employeeId,
    punchLogId: punchId,
    recordType: "punch",
    workDate,
  });
  return exp.id;
}

async function deletePunch(fx: Fixture, punchId: string) {
  const res = await fetch(`${fx.baseUrl}/api/attendance/punches/${punchId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${fx.reviewerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason: "test" }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test("locked-period: deleting a punch in a LOCKED payroll batch is blocked (409 PAYROLL_FINALIZED)", async (t) => {
  const fx = await setupFixture("locked");
  t.after(fx.cleanup);
  const track = (fx.cleanup as any).track as (id: string) => void;

  const workDate = "2026-02-02";
  const punchId = await makePunch(fx.employeeId, workDate);
  await makeExportWithPunch(REVIEWER_ID, fx.employeeId, punchId, workDate, "locked", track);

  const { status, body } = await deletePunch(fx, punchId);
  assert.equal(status, 409);
  assert.equal(body.code, "PAYROLL_FINALIZED");

  // The punch must survive the blocked delete.
  const stillThere = await storage.getPunchLog(punchId);
  assert.ok(stillThere, "punch must NOT be deleted while payroll is finalized");
});

test("locked-period: deleting a punch in an EXPORTED payroll batch is blocked (409 PAYROLL_FINALIZED)", async (t) => {
  const fx = await setupFixture("exported");
  t.after(fx.cleanup);
  const track = (fx.cleanup as any).track as (id: string) => void;

  const workDate = "2026-02-03";
  const punchId = await makePunch(fx.employeeId, workDate);
  await makeExportWithPunch(REVIEWER_ID, fx.employeeId, punchId, workDate, "exported", track);

  const { status, body } = await deletePunch(fx, punchId);
  assert.equal(status, 409);
  assert.equal(body.code, "PAYROLL_FINALIZED");
  assert.ok(await storage.getPunchLog(punchId), "punch must survive");
});

test("locked-period: deleting a punch tied only to a DRAFT export succeeds", async (t) => {
  const fx = await setupFixture("draft");
  t.after(fx.cleanup);
  const track = (fx.cleanup as any).track as (id: string) => void;

  const workDate = "2026-02-04";
  const punchId = await makePunch(fx.employeeId, workDate);
  await makeExportWithPunch(REVIEWER_ID, fx.employeeId, punchId, workDate, "draft", track);

  const { status, body } = await deletePunch(fx, punchId);
  assert.equal(status, 200);
  assert.equal(body.deleted, true);
  assert.equal(await storage.getPunchLog(punchId), undefined);
});
