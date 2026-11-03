/**
 * Timezone work-date fix (live paths + backfill).
 *
 * Bug: live clock-ins stamped workDate from the UTC date, so an evening Eastern
 * shift (after ~7pm EST) rolled onto the next calendar day. These cover:
 *   - the manual add-punch route now files under the location-LOCAL day; and
 *   - POST /api/attendance/backfill-work-dates previews (dry run) and then moves
 *     a mis-dated punch to the correct local day, idempotently.
 *
 * Employees here have no location, so resolveEmployeeTimezone falls back to the
 * DEFAULT_TIMEZONE (America/New_York) — exactly Ahava's zone.
 *
 * Run with: `npx tsx server/__tests__/workDateBackfill.test.ts` (needs DATABASE_URL).
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
import { users, punchLogs, attendanceLedger, attendanceChangeLedger } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const ADMIN_ID = "admin-dev-001";
const stamp = `wdtz-${Date.now().toString(36)}`;

let baseUrl = "";
let adminToken = "";
let employeeId = "";
let httpServer: http.Server;

async function setup() {
  const app = express();
  app.use(express.json());
  httpServer = http.createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const admin = await storage.getUser(ADMIN_ID);
  assert.ok(admin, "expected seeded admin-dev-001");
  assert.equal(admin!.role, "admin", "admin-dev-001 must be an admin for the backfill route");
  adminToken = generateToken({ id: admin!.id, email: admin!.email, role: admin!.role, companyId: admin!.companyId });

  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Tz", lastName: stamp, role: "employee", companyId: admin!.companyId,
  }).returning();
  employeeId = emp.id;
}

async function cleanup() {
  await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, employeeId)).catch(() => {});
  await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
  await new Promise<void>((r) => httpServer.close(() => r()));
}

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("timezone work-date: add + backfill", async (t) => {
  await setup();
  t.after(cleanup);

  // 1) Manual add with an evening-Eastern clock-in: 2026-11-03T01:00:00Z = 2026-11-02 20:00 EST.
  // It must file under 2026-11-02 (local), not 2026-11-03 (UTC).
  const addRes = await post("/api/attendance/punches", {
    employeeId,
    clockIn: "2026-11-03T01:00:00Z",
    clockOut: "2026-11-03T04:00:00Z",
    reason: "evening shift",
  });
  assert.equal(addRes.status, 201, `add failed: ${await addRes.clone().text()}`);
  const added = await addRes.json();
  assert.equal(added.workDate, "2026-11-02", "manual add files under the local Eastern day");

  // 2) Seed a punch stamped with the WRONG (UTC) workDate to simulate the old bug.
  const [bad] = await db.insert(punchLogs).values({
    employeeId,
    workDate: "2026-11-03", // wrong — should be 2026-11-02 for this clock-in
    clockIn: new Date("2026-11-03T02:00:00Z"), // 2026-11-02 21:00 EST
    clockOut: new Date("2026-11-03T05:00:00Z"),
    hoursWorked: 3,
    status: "complete",
    source: "test",
    approved: true,
  }).returning();

  // 3) Dry run: reports it as fixable, changes nothing.
  const dryRes = await post("/api/attendance/backfill-work-dates", { apply: false });
  assert.equal(dryRes.status, 200);
  const dry = await dryRes.json();
  assert.equal(dry.applied, false);
  assert.ok(dry.toFix >= 1, "dry run finds at least the seeded bad punch");
  const stillBad = await storage.getPunchLog(bad.id);
  assert.equal(stillBad?.workDate, "2026-11-03", "dry run did not change anything");

  // 4) Apply: the bad punch moves to the correct local day.
  const applyRes = await post("/api/attendance/backfill-work-dates", { apply: true });
  assert.equal(applyRes.status, 200);
  const applied = await applyRes.json();
  assert.equal(applied.applied, true);
  assert.ok((applied.fixed ?? 0) >= 1);
  const fixed = await storage.getPunchLog(bad.id);
  assert.equal(fixed?.workDate, "2026-11-02", "backfill moved the punch to the correct local day");

  // 5) Idempotent: running apply again leaves our punches correct (no flip-back).
  const againRes = await post("/api/attendance/backfill-work-dates", { apply: true });
  assert.equal(againRes.status, 200);
  const stillFixed = await storage.getPunchLog(bad.id);
  assert.equal(stillFixed?.workDate, "2026-11-02", "second run keeps the correct day");
  const addedRow = await storage.getPunchLog(added.id);
  assert.equal(addedRow?.workDate, "2026-11-02", "the correctly-added punch is never moved");
});
