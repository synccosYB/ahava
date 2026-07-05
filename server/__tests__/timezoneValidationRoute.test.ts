/**
 * HTTP-level regression coverage for the timezone guard added in task #514
 * (`normalizeTimezoneField` in server/routes.ts), extended by task #516.
 *
 * Task #514 added validation/normalization to the company & location
 * create/edit routes, but there was no test proving the SAVE endpoints actually
 * reject or coerce a malformed timezone — so a refactor could silently drop the
 * guard on one of the four routes and let a bad value be persisted again.
 *
 * These run through the REAL Express routes + REAL auth so the production guard
 * is exercised, not a re-implementation. For every route we assert BOTH cases:
 *   - a recoverable-but-malformed zone ("America/New york") is coerced to its
 *     canonical form ("America/New_York") — never stored verbatim, and
 *   - an unrecoverable garbage zone is rejected with a 400.
 *
 * Covers all four routes: company POST/PATCH, location POST/PATCH.
 *
 * Mirrors the registerRoutes fixture pattern from punchIntegrityRoute.test.ts.
 *
 * Run with: `npx tsx server/__tests__/timezoneValidationRoute.test.ts`  (requires DATABASE_URL)
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
import { companies, locations, locationCompanies } from "@shared/schema";
import { eq } from "drizzle-orm";

const ADMIN_ID = "admin-dev-001";
const NAME_PREFIX = "tzvalidation-test-";
const MALFORMED = "America/New york"; // recoverable: bad separator/case
const CANONICAL = "America/New_York";
const GARBAGE = "Not/ARealZone"; // unrecoverable: must be rejected

type Fixture = {
  baseUrl: string;
  adminToken: string;
  companyId: string;
  cleanup: () => Promise<void>;
};

async function purgeLeftovers() {
  const allCompanies = await db.select().from(companies);
  const staleCompanies = allCompanies.filter((c) => c.name?.startsWith(NAME_PREFIX));
  const allLocations = await db.select().from(locations);
  const staleLocations = allLocations.filter((l) => l.name?.startsWith(NAME_PREFIX));
  for (const l of staleLocations) {
    await db.delete(locationCompanies).where(eq(locationCompanies.locationId, l.id));
    await db.delete(locations).where(eq(locations.id, l.id));
  }
  for (const c of staleCompanies) {
    await db.delete(locationCompanies).where(eq(locationCompanies.companyId, c.id));
    await db.delete(companies).where(eq(companies.id, c.id));
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

  const admin = await storage.getUser(ADMIN_ID);
  assert.ok(admin, "expected seeded admin-dev-001 user");
  const adminToken = generateToken({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    companyId: admin.companyId,
  });

  // A parent company the locations can hang off of (locations.companyId is NOT NULL).
  const [company] = await db
    .insert(companies)
    .values({ name: `${NAME_PREFIX}parent-${label}`, timezone: CANONICAL })
    .returning();

  const cleanup = async () => {
    await purgeLeftovers();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { baseUrl, adminToken, companyId: company.id, cleanup };
}

async function req(
  fx: Fixture,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`${fx.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${fx.adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const resBody = await res.json().catch(() => ({}));
  return { status: res.status, body: resBody };
}

// A malformed-but-recoverable timezone must NEVER be stored verbatim: the guard
// either coerces it to canonical form (2xx) or rejects it (400).
function assertCoercedOrRejected(status: number, body: any, label: string) {
  if (status >= 200 && status < 300) {
    assert.equal(
      body.timezone,
      CANONICAL,
      `${label}: expected timezone coerced to ${CANONICAL}, got ${JSON.stringify(body.timezone)}`,
    );
  } else {
    assert.equal(status, 400, `${label}: expected 400 or a 2xx coercion, got ${status}`);
  }
  assert.notEqual(body.timezone, MALFORMED, `${label}: malformed value must not be persisted`);
}

test("company POST: malformed timezone is coerced or rejected", async (t) => {
  const fx = await setupFixture("company-post");
  t.after(fx.cleanup);

  const r = await req(fx, "POST", "/api/companies", {
    name: `${NAME_PREFIX}co-post`,
    timezone: MALFORMED,
  });
  assertCoercedOrRejected(r.status, r.body, "company POST");
});

test("company POST: unrecoverable timezone is rejected (400)", async (t) => {
  const fx = await setupFixture("company-post-bad");
  t.after(fx.cleanup);

  const r = await req(fx, "POST", "/api/companies", {
    name: `${NAME_PREFIX}co-post-bad`,
    timezone: GARBAGE,
  });
  assert.equal(r.status, 400, `expected 400 for garbage timezone, got ${r.status} ${JSON.stringify(r.body)}`);
});

test("company PATCH: malformed timezone is coerced or rejected", async (t) => {
  const fx = await setupFixture("company-patch");
  t.after(fx.cleanup);

  // A clean company to edit.
  const created = await req(fx, "POST", "/api/companies", {
    name: `${NAME_PREFIX}co-patch`,
    timezone: CANONICAL,
  });
  assert.equal(created.status, 201, `setup POST failed: ${JSON.stringify(created.body)}`);

  const r = await req(fx, "PATCH", `/api/companies/${created.body.id}`, {
    timezone: MALFORMED,
  });
  assertCoercedOrRejected(r.status, r.body, "company PATCH");

  // The persisted row must never hold the malformed string.
  const after = await storage.getCompany(created.body.id);
  assert.notEqual(after?.timezone, MALFORMED, "company PATCH: DB must not hold malformed tz");
});

test("company PATCH: unrecoverable timezone is rejected (400)", async (t) => {
  const fx = await setupFixture("company-patch-bad");
  t.after(fx.cleanup);

  const created = await req(fx, "POST", "/api/companies", {
    name: `${NAME_PREFIX}co-patch-bad`,
    timezone: CANONICAL,
  });
  assert.equal(created.status, 201, `setup POST failed: ${JSON.stringify(created.body)}`);

  const r = await req(fx, "PATCH", `/api/companies/${created.body.id}`, {
    timezone: GARBAGE,
  });
  assert.equal(r.status, 400, `expected 400 for garbage timezone, got ${r.status} ${JSON.stringify(r.body)}`);

  const after = await storage.getCompany(created.body.id);
  assert.equal(after?.timezone, CANONICAL, "company PATCH: rejected edit must leave tz unchanged");
});

test("location POST: malformed timezone is coerced or rejected", async (t) => {
  const fx = await setupFixture("location-post");
  t.after(fx.cleanup);

  const r = await req(fx, "POST", "/api/locations", {
    name: `${NAME_PREFIX}loc-post`,
    companyId: fx.companyId,
    timezone: MALFORMED,
  });
  assertCoercedOrRejected(r.status, r.body, "location POST");
});

test("location POST: unrecoverable timezone is rejected (400)", async (t) => {
  const fx = await setupFixture("location-post-bad");
  t.after(fx.cleanup);

  const r = await req(fx, "POST", "/api/locations", {
    name: `${NAME_PREFIX}loc-post-bad`,
    companyId: fx.companyId,
    timezone: GARBAGE,
  });
  assert.equal(r.status, 400, `expected 400 for garbage timezone, got ${r.status} ${JSON.stringify(r.body)}`);
});

test("location PATCH: malformed timezone is coerced or rejected", async (t) => {
  const fx = await setupFixture("location-patch");
  t.after(fx.cleanup);

  const created = await req(fx, "POST", "/api/locations", {
    name: `${NAME_PREFIX}loc-patch`,
    companyId: fx.companyId,
    timezone: CANONICAL,
  });
  assert.equal(created.status, 201, `setup POST failed: ${JSON.stringify(created.body)}`);

  const r = await req(fx, "PATCH", `/api/locations/${created.body.id}`, {
    timezone: MALFORMED,
  });
  assertCoercedOrRejected(r.status, r.body, "location PATCH");

  const after = await storage.getLocation(created.body.id);
  assert.notEqual(after?.timezone, MALFORMED, "location PATCH: DB must not hold malformed tz");
});

test("location PATCH: unrecoverable timezone is rejected (400)", async (t) => {
  const fx = await setupFixture("location-patch-bad");
  t.after(fx.cleanup);

  const created = await req(fx, "POST", "/api/locations", {
    name: `${NAME_PREFIX}loc-patch-bad`,
    companyId: fx.companyId,
    timezone: CANONICAL,
  });
  assert.equal(created.status, 201, `setup POST failed: ${JSON.stringify(created.body)}`);

  const r = await req(fx, "PATCH", `/api/locations/${created.body.id}`, {
    timezone: GARBAGE,
  });
  assert.equal(r.status, 400, `expected 400 for garbage timezone, got ${r.status} ${JSON.stringify(r.body)}`);

  const after = await storage.getLocation(created.body.id);
  assert.equal(after?.timezone, CANONICAL, "location PATCH: rejected edit must leave tz unchanged");
});
