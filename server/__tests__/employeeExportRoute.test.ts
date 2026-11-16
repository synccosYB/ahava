/**
 * Regression: GET /api/users/export must resolve to the export handler, NOT be
 * swallowed by GET /api/users/:id (which would 404 with id="export"). Boots the
 * real route table and checks the response is the xlsx download.
 *
 * Run with: `npx tsx server/__tests__/employeeExportRoute.test.ts` (needs DATABASE_URL + seed).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

test("GET /api/users/export resolves to the export handler (not shadowed by :id)", async (t) => {
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const token = generateToken(admin);
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const res = await fetch(`${origin}/api/users/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status} (404 => route shadowed by :id)`);
  assert.match(
    res.headers.get("content-type") ?? "",
    /spreadsheetml\.sheet/,
    "response is an .xlsx workbook",
  );
  const buf = Buffer.from(await res.arrayBuffer());
  // .xlsx is a zip — first two bytes are "PK".
  assert.equal(buf.subarray(0, 2).toString(), "PK", "body is a real xlsx (zip) file");
});
