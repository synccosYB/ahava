/**
 * Permission-boundary coverage for attendance & payroll across the seeded roles
 * (Employee / Department Manager / Payroll Admin / Division Admin / Super Admin).
 *
 * Boots the real DB + seeded roles/permissions, then drives the REAL
 * `requirePermission` middleware (the same gate used in server/routes.ts) behind
 * a stubbed auth that injects authUser. Asserts both:
 *   1. resolveUserPermissions() — the resolved permission set per role, and
 *   2. HTTP 200 vs 403 through requirePermission for the key attendance/payroll keys.
 *
 * This locks in the privilege boundaries documented in the project:
 *   - Employee: clock + view_self only (no edit, no payroll.manage, no view_all)
 *   - Department Manager: attendance.edit/delete/approve_corrections, NO payroll.manage
 *   - Payroll Admin: payroll.manage/export + attendance.view_all, but NOT attendance.edit
 *   - Division Admin: attendance.edit + payroll.manage
 *   - Super Admin: everything (system.super_admin bypass)
 *
 * Run with: `npx tsx server/__tests__/attendancePayrollPermissions.test.ts`  (requires DATABASE_URL)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { seed } from "../seed";
import { requirePermission, resolveUserPermissions } from "../middleware/rbac";

await seed();

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const createdUserIds: string[] = [];

const allRoles = await db.select().from(schema.roles);
function roleId(name: string): string {
  const r = allRoles.find((x) => x.name === name);
  assert.ok(r, `role ${name} must be seeded`);
  return r!.id;
}

async function makeUser(roleName: string, role: "admin" | "manager" | "employee"): Promise<string> {
  const id = `perm-${roleName.replace(/\s+/g, "")}-${stamp}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Perm",
    lastName: roleName,
    role,
  });
  await db.insert(schema.userRoles).values({ userId: id, roleId: roleId(roleName) });
  createdUserIds.push(id);
  return id;
}

const users = {
  employee: await makeUser("Employee", "employee"),
  deptManager: await makeUser("Department Manager", "manager"),
  payrollAdmin: await makeUser("Payroll Admin", "admin"),
  divisionAdmin: await makeUser("Division Admin", "admin"),
  superAdmin: await makeUser("Super Admin", "admin"),
};

// A tiny app exposing one endpoint per permission key, gated by the REAL
// requirePermission middleware. Auth is stubbed to inject the target user.
function buildApp(asUserId: string) {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, asUserId));
    (req as any).authUser = u;
    next();
  });
  const gated = (key: string) => [requirePermission(key), (_req: any, res: any) => res.json({ ok: true })];
  app.get("/attendance.clock", ...gated("attendance.clock"));
  app.get("/attendance.view_self", ...gated("attendance.view_self"));
  app.get("/attendance.view_all", ...gated("attendance.view_all"));
  app.get("/attendance.edit", ...gated("attendance.edit"));
  app.get("/attendance.delete", ...gated("attendance.delete"));
  app.get("/attendance.approve_corrections", ...gated("attendance.approve_corrections"));
  app.get("/payroll.view_self", ...gated("payroll.view_self"));
  app.get("/payroll.view_all", ...gated("payroll.view_all"));
  app.get("/payroll.manage", ...gated("payroll.manage"));
  app.get("/payroll.export", ...gated("payroll.export"));
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

async function status(base: string, key: string): Promise<number> {
  const r = await fetch(`${base}/${key}`);
  return r.status;
}

/**
 * Assert the full allow/deny matrix for one role in a single booted app.
 * `allow` lists keys that must return 200; every other gated key must return 403.
 */
async function assertMatrix(userId: string, label: string, allow: string[]) {
  const allKeys = [
    "attendance.clock", "attendance.view_self", "attendance.view_all",
    "attendance.edit", "attendance.delete", "attendance.approve_corrections",
    "payroll.view_self", "payroll.view_all", "payroll.manage", "payroll.export",
  ];
  const { url, close } = await listen(buildApp(userId));
  try {
    for (const key of allKeys) {
      const expected = allow.includes(key) ? 200 : 403;
      const got = await status(url, key);
      assert.equal(got, expected, `${label}: ${key} expected ${expected}, got ${got}`);
    }
  } finally {
    close();
  }
}

test.after(async () => {
  if (createdUserIds.length) {
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, createdUserIds));
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  }
});

test("resolved permission sets match the seeded role catalog", async () => {
  const emp = await resolveUserPermissions(users.employee);
  assert.ok(emp.has("attendance.clock") && emp.has("attendance.view_self") && emp.has("payroll.view_self"));
  assert.ok(!emp.has("attendance.edit") && !emp.has("attendance.view_all") && !emp.has("payroll.manage"));

  const mgr = await resolveUserPermissions(users.deptManager);
  assert.ok(mgr.has("attendance.edit") && mgr.has("attendance.delete") && mgr.has("attendance.approve_corrections"));
  assert.ok(!mgr.has("payroll.manage") && !mgr.has("payroll.export") && !mgr.has("attendance.view_all"));

  const pay = await resolveUserPermissions(users.payrollAdmin);
  assert.ok(pay.has("payroll.manage") && pay.has("payroll.export") && pay.has("attendance.view_all"));
  assert.ok(!pay.has("attendance.edit") && !pay.has("attendance.delete"));

  const div = await resolveUserPermissions(users.divisionAdmin);
  assert.ok(div.has("attendance.edit") && div.has("payroll.manage") && div.has("payroll.export"));

  const sup = await resolveUserPermissions(users.superAdmin);
  assert.ok(sup.has("system.super_admin"));
});

test("Employee: clock + view_self only", async () => {
  await assertMatrix(users.employee, "Employee", [
    "attendance.clock", "attendance.view_self", "payroll.view_self",
  ]);
});

test("Department Manager: attendance edit/delete/approve, but no payroll management", async () => {
  await assertMatrix(users.deptManager, "Department Manager", [
    "attendance.clock", "attendance.view_self",
    "attendance.edit", "attendance.delete", "attendance.approve_corrections",
    "payroll.view_self",
  ]);
});

test("Payroll Admin: payroll manage/export + attendance.view_all, but cannot edit attendance", async () => {
  await assertMatrix(users.payrollAdmin, "Payroll Admin", [
    "attendance.view_all",
    "payroll.view_all", "payroll.manage", "payroll.export",
  ]);
});

test("Division Admin: full attendance + full payroll", async () => {
  await assertMatrix(users.divisionAdmin, "Division Admin", [
    "attendance.view_all", "attendance.edit", "attendance.delete", "attendance.approve_corrections",
    "payroll.view_all", "payroll.manage", "payroll.export",
  ]);
});

test("Super Admin: bypass grants every gated key", async () => {
  await assertMatrix(users.superAdmin, "Super Admin", [
    "attendance.clock", "attendance.view_self", "attendance.view_all",
    "attendance.edit", "attendance.delete", "attendance.approve_corrections",
    "payroll.view_self", "payroll.view_all", "payroll.manage", "payroll.export",
  ]);
});

test("unauthenticated requests are rejected with 401", async () => {
  const app = express();
  app.use(express.json());
  app.get("/attendance.edit", requirePermission("attendance.edit"), (_req, res) => res.json({ ok: true }));
  const { url, close } = await listen(app);
  try {
    const r = await fetch(`${url}/attendance.edit`);
    assert.equal(r.status, 401);
  } finally {
    close();
  }
});
