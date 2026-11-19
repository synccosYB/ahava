/**
 * PATCH /api/employment-profiles/:userId — setting an existing employee's Clock #
 * (employee number). It must be numeric and unique across employees (so an import
 * always resolves it to one person), and an empty value clears it.
 *
 * Run with: `npx tsx server/__tests__/employeeNumberEdit.test.ts` (needs DATABASE_URL + seed).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { users, userEmploymentProfiles } from "@shared/schema";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("PATCH employment-profile Clock #: numeric, unique, clearable", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const token = generateToken(admin);

  const stamp = Date.now().toString().slice(-6); // a 6-digit numeric base, unique per run
  const taken = `${stamp}1`;
  const free = `${stamp}2`;

  const target = await storage.createUser({ firstName: "NoNum", lastName: `Edit${stamp}`, role: "employee" });
  const other = await storage.createUser({ firstName: "Has", lastName: `Num${stamp}`, role: "employee" });
  await storage.createEmploymentProfile({ userId: target.id, payType: "hourly", hourlyRate: 15 });
  await storage.createEmploymentProfile({ userId: other.id, employeeNumber: taken, payType: "hourly", hourlyRate: 15 });

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const ids = [target.id, other.id];
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, ids)).catch(() => {});
    await db.delete(users).where(inArray(users.id, ids)).catch(() => {});
  });

  const patch = (userId: string, employeeNumber: string) =>
    fetch(`${origin}/api/employment-profiles/${userId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNumber }),
    });

  // Non-numeric -> 400.
  assert.equal((await patch(target.id, "abc12")).status, 400, "non-numeric Clock # rejected");

  // Already used by someone else -> 409.
  assert.equal((await patch(target.id, taken)).status, 409, "duplicate Clock # rejected");

  // A free numeric value -> 200 and stored.
  assert.equal((await patch(target.id, free)).status, 200, "unique numeric Clock # accepted");
  assert.equal((await storage.getEmploymentProfile(target.id))?.employeeNumber, free, "Clock # saved");

  // Re-saving the SAME value on the same person is fine (not a self-clash).
  assert.equal((await patch(target.id, free)).status, 200, "re-saving own Clock # is allowed");

  // Empty clears it.
  assert.equal((await patch(target.id, "")).status, 200, "empty clears Clock #");
  assert.equal((await storage.getEmploymentProfile(target.id))?.employeeNumber, null, "Clock # cleared to null");
});
