/**
 * Punch-changes undo: the admin can revert an add / edit / move-day / delete of
 * a punch from the change log, with before/after restored, stale undos refused,
 * and the undo itself logged. Exercised through the real routes.
 *
 * Run with: `npx tsx server/__tests__/punchUndo.test.ts` (needs DATABASE_URL).
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
const stamp = `undo-${Date.now().toString(36)}`;

let baseUrl = "";
let token = "";
let employeeId = "";
let httpServer: http.Server;
const punchIds: string[] = [];

async function setup() {
  const app = express();
  app.use(express.json());
  httpServer = http.createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const admin = await storage.getUser(ADMIN_ID);
  assert.ok(admin);
  token = generateToken({ id: admin!.id, email: admin!.email, role: admin!.role, companyId: admin!.companyId });
  const [emp] = await db.insert(users).values({
    email: `${stamp}@example.invalid`, firstName: "Undo", lastName: stamp, role: "employee", companyId: admin!.companyId,
  }).returning();
  employeeId = emp.id;
}
async function cleanup() {
  // Leave audit_logs (orphaned punch rows are harmless in the test DB); don't
  // touch other admin audit history.
  await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, employeeId)).catch(() => {});
  await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, employeeId)).catch(() => {});
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, employeeId)).catch(() => {});
  await db.delete(users).where(eq(users.id, employeeId)).catch(() => {});
  await new Promise<void>((r) => httpServer.close(() => r()));
}
const api = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

async function changesFor(kind?: string) {
  const res = await api("GET", `/api/attendance/punch-changes?employeeId=${employeeId}&limit=200`);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!body || !Array.isArray(body.changes)) {
    throw new Error(`punch-changes GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const rows = body.changes as any[];
  return kind ? rows.filter((r) => r.kind === kind) : rows;
}

test("undo edit restores the punch's original time", async (t) => {
  if (!baseUrl) await setup();
  const addRes = await api("POST", "/api/attendance/punches", {
    employeeId, clockIn: "2026-05-04T13:00:00Z", clockOut: "2026-05-04T21:00:00Z",
  });
  const p = await addRes.json();
  punchIds.push(p.id);
  // Shorten the shift.
  await api("PATCH", `/api/attendance/punches/${p.id}`, { clockOut: "2026-05-04T17:00:00Z" });
  const edited = (await changesFor("Edited"))[0];
  assert.ok(edited, "an Edited entry exists");

  const undo = await api("POST", `/api/audit-logs/${edited.id}/undo`, {});
  assert.equal(undo.status, 200, await undo.clone().text());
  const after = await storage.getPunchLog(p.id);
  assert.equal(new Date(after!.clockOut as any).toISOString(), "2026-05-04T21:00:00.000Z", "clock-out restored");
  assert.equal(Number(after!.hoursWorked), 8, "hours recomputed to the original 8");
});

test("undo add removes the created punch", async (t) => {
  const addRes = await api("POST", "/api/attendance/punches", {
    employeeId, clockIn: "2026-05-06T13:00:00Z", clockOut: "2026-05-06T18:00:00Z",
  });
  const p = await addRes.json();
  const added = (await changesFor("Added")).find((r) => true);
  assert.ok(added);
  const undo = await api("POST", `/api/audit-logs/${added.id}/undo`, {});
  assert.equal(undo.status, 200, await undo.clone().text());
  assert.equal(await storage.getPunchLog(p.id), undefined, "created punch was removed");
});

test("undo delete recreates the punch", async (t) => {
  const addRes = await api("POST", "/api/attendance/punches", {
    employeeId, clockIn: "2026-05-08T13:00:00Z", clockOut: "2026-05-08T21:00:00Z",
  });
  const p = await addRes.json();
  await api("DELETE", `/api/attendance/punches/${p.id}`, { reason: "oops" });
  assert.equal(await storage.getPunchLog(p.id), undefined, "deleted");
  const del = (await changesFor("Deleted"))[0];
  assert.ok(del);
  const undo = await api("POST", `/api/audit-logs/${del.id}/undo`, {});
  assert.equal(undo.status, 200, await undo.clone().text());
  // A punch for that day/time exists again (new id).
  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, employeeId));
  assert.ok(rows.some((r) => r.workDate === "2026-05-08" && Number(r.hoursWorked) === 8), "punch recreated");
});

test("a stale undo is refused (punch changed again since)", async (t) => {
  const addRes = await api("POST", "/api/attendance/punches", {
    employeeId, clockIn: "2026-05-10T13:00:00Z", clockOut: "2026-05-10T21:00:00Z",
  });
  const p = await addRes.json();
  await api("PATCH", `/api/attendance/punches/${p.id}`, { clockOut: "2026-05-10T19:00:00Z" }); // edit 1
  const edit1 = (await changesFor("Edited")).find((r) => r.after && new Date(r.after.clockOut).toISOString() === "2026-05-10T19:00:00.000Z");
  assert.ok(edit1, "found edit 1");
  await api("PATCH", `/api/attendance/punches/${p.id}`, { clockOut: "2026-05-10T15:00:00Z" }); // edit 2
  const undo = await api("POST", `/api/audit-logs/${edit1.id}/undo`, {});
  assert.equal(undo.status, 409, "undoing the older edit is refused as stale");
  t.after(cleanup);
});
