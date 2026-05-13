/**
 * Regression test for task #210 — Division Admin (not Super Admin) must be able to
 * create / edit / delete companies after the company.* permission catalog was
 * restored. Also verifies a plain Employee is denied (no privilege creep).
 *
 * Boots only what's needed: real DB, seeded permissions/roles, an in-process
 * Express app wired with requireAuth-equivalent stub + the real
 * `requirePermission` middleware + the real /api/companies handlers.
 *
 * Run with: `tsx server/__tests__/companyPermissions.test.ts`
 *
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { eq } from "drizzle-orm";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { seed } = await import("../seed.js");
const { requirePermission, resolveUserPermissions } = await import(
  "../middleware/rbac.js"
);
const { storage } = await import("../storage.js");

// Mirror the production requireRole("admin") gate so the test exercises the same
// middleware chain (requireAuth → requireRole → requirePermission) as
// /api/companies in server/routes.ts.
const requireRoleAdmin: import("express").RequestHandler = (req, res, next) => {
  const u = (req as any).authUser;
  if (!u || u.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: admin role required" });
  }
  next();
};

await seed();

const allRoles = await db.select().from(schema.roles);
const divisionAdminRole = allRoles.find((r) => r.name === "Division Admin");
const employeeRole = allRoles.find((r) => r.name === "Employee");
assert.ok(divisionAdminRole, "Division Admin role must be seeded");
assert.ok(employeeRole, "Employee role must be seeded");

async function makeUser(idPrefix: string, roleId: string, role: "admin" | "employee") {
  const id = `${idPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Test",
    lastName: idPrefix,
    role,
  });
  await db.insert(schema.userRoles).values({ userId: id, roleId });
  return id;
}

const divAdminId = await makeUser("divadmin", divisionAdminRole!.id, "admin");
const employeeId = await makeUser("emp", employeeRole!.id, "employee");

// Sanity: resolved permissions
const divAdminPerms = await resolveUserPermissions(divAdminId);
for (const k of ["company.create", "company.edit", "company.delete"]) {
  assert.ok(
    divAdminPerms.has(k),
    `Division Admin must resolve permission ${k}; got: ${[...divAdminPerms].sort().join(",")}`,
  );
}
assert.ok(!divAdminPerms.has("system.super_admin"), "Division Admin must NOT have super_admin");

const empPerms = await resolveUserPermissions(employeeId);
assert.ok(!empPerms.has("company.create"), "Employee must NOT have company.create");

// Mount real route handlers behind a stubbed auth that injects authUser.
function buildApp(asUserId: string) {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, asUserId));
    (req as any).authUser = u;
    next();
  });
  // Mirror the real /api/companies POST/PATCH/DELETE pipeline (requirePermission only;
  // the requireRole("admin") gate is exercised separately by the e2e flow).
  app.post(
    "/api/companies",
    requireRoleAdmin,
    requirePermission("company.create"),
    async (req, res) => {
      const parsed = schema.insertCompanySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "bad" });
      const company = await storage.createCompany(parsed.data);
      res.status(201).json(company);
    },
  );
  app.patch(
    "/api/companies/:id",
    requireRoleAdmin,
    requirePermission("company.edit"),
    async (req, res) => {
      const parsed = schema.insertCompanySchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "bad" });
      const c = await storage.updateCompany(req.params.id, parsed.data);
      if (!c) return res.status(404).json({ message: "Not found" });
      res.json(c);
    },
  );
  app.delete(
    "/api/companies/:id",
    requireRoleAdmin,
    requirePermission("company.delete"),
    async (req, res) => {
      await storage.deleteCompany(req.params.id);
      res.status(204).send();
    },
  );
  return app;
}

function listen(app: express.Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function req(base: string, method: string, path: string, body?: any) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

const createdIds: string[] = [];

// --- Division Admin: POST 201 ---
{
  const { url: base, close } = await listen(buildApp(divAdminId));
  try {
    const r = await req(base, "POST", "/api/companies", {
      name: `Test Division ${Date.now()}`,
    });
    assert.equal(r.status, 201, `POST as Division Admin expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
    assert.ok(r.body?.id, "POST response should include id");
    createdIds.push(r.body.id);

    const r2 = await req(base, "PATCH", `/api/companies/${r.body.id}`, {
      name: `Renamed ${Date.now()}`,
    });
    assert.equal(r2.status, 200, `PATCH as Division Admin expected 200, got ${r2.status}`);
  } finally {
    close();
  }
}

// --- Employee: POST 403 (caught by requireRole admin gate — no privilege creep) ---
{
  const { url: base, close } = await listen(buildApp(employeeId));
  try {
    const r = await req(base, "POST", "/api/companies", { name: "Should Fail" });
    assert.equal(r.status, 403, `POST as Employee expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
  } finally {
    close();
  }
}

// Cleanup
for (const id of createdIds) {
  try { await storage.deleteCompany(id); } catch {}
}
await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, divAdminId));
await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, employeeId));
await db.delete(schema.users).where(eq(schema.users.id, divAdminId));
await db.delete(schema.users).where(eq(schema.users.id, employeeId));

console.log("OK — company.* permissions restored; Division Admin can create/edit, Employee is denied.");
process.exit(0);
