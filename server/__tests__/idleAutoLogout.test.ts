/**
 * Global idle auto-logout settings + per-admin opt-out.
 *   - GET/PUT /api/settings/session round-trips the company-wide idle timeout
 *     (minutes; 0 = off) on the operational company.
 *   - An admin can opt themselves out via PATCH /api/users/:id (idleLogoutExempt),
 *     and the flag persists on their user row.
 *
 * Run with: `npx tsx server/__tests__/idleAutoLogout.test.ts` (needs DATABASE_URL + seed).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { companies, users } from "@shared/schema";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("idle auto-logout: company setting round-trips and admin can opt out", async (t) => {
  const stamp = Date.now().toString(36);
  // The operational company is a global singleton (getOperationalCompany). The
  // seed creates no company, so on a clean CI database we create one; on a
  // populated DB we reuse and restore it. `createdCompany` tracks which.
  let op = await storage.getOperationalCompany();
  const createdCompany = !op;
  if (!op) op = await storage.createCompany({ name: "Ahava Medical Center" });
  const originalMinutes = op.idleLogoutMinutes ?? 0;

  const admin = await storage.createUser({
    firstName: "IdleAdmin", lastName: stamp, role: "admin", companyId: op.id,
  });

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = generateToken(admin);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(users).where(inArray(users.id, [admin.id])).catch(() => {});
    // Restore or remove the operational company so we don't leak state.
    if (createdCompany) await db.delete(companies).where(eq(companies.id, op.id)).catch(() => {});
    else await storage.updateCompany(op.id, { idleLogoutMinutes: originalMinutes }).catch(() => {});
  });

  // --- Company-wide setting: PUT then GET reflect the new value. ---
  const put = await fetch(`${origin}/api/settings/session`, {
    method: "PUT", headers: auth, body: JSON.stringify({ idleLogoutMinutes: 7 }),
  });
  assert.equal(put.status, 200, `admin can set the idle timeout (got ${put.status})`);
  assert.equal((await put.json()).idleLogoutMinutes, 7, "PUT echoes the saved value");

  const get = await fetch(`${origin}/api/settings/session`, { headers: auth });
  assert.equal(get.status, 200, "GET settings is readable");
  assert.equal((await get.json()).idleLogoutMinutes, 7, "GET reflects the saved timeout");

  // Out-of-range minutes are rejected.
  const bad = await fetch(`${origin}/api/settings/session`, {
    method: "PUT", headers: auth, body: JSON.stringify({ idleLogoutMinutes: 5000 }),
  });
  assert.equal(bad.status, 400, "minutes above the 1440 cap are rejected");

  // --- Per-admin opt-out: PATCH self with idleLogoutExempt persists. ---
  const patchOn = await fetch(`${origin}/api/users/${admin.id}`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ idleLogoutExempt: true }),
  });
  assert.equal(patchOn.status, 200, `admin can opt out of auto-logout (got ${patchOn.status})`);
  let [row] = await db.select().from(users).where(eq(users.id, admin.id));
  assert.equal(row.idleLogoutExempt, true, "opt-out flag persisted true");

  // ...and can turn it back on.
  const patchOff = await fetch(`${origin}/api/users/${admin.id}`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ idleLogoutExempt: false }),
  });
  assert.equal(patchOff.status, 200, "admin can re-enable auto-logout for themselves");
  [row] = await db.select().from(users).where(eq(users.id, admin.id));
  assert.equal(row.idleLogoutExempt, false, "opt-out flag persisted false");
});
