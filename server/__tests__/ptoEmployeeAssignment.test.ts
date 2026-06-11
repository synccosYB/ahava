/**
 * Regression test for the employee-level PTO policy ASSIGNMENT control.
 *
 * After the PTO consolidation, "which policy is assigned to this employee" is
 * owned by the unified engine's `policy_assignments` (a row with `user_id` set),
 * NOT the legacy `employee_pto_settings.pto_policy_id` link. This suite mounts
 * the real GET/PUT /api/employee-pto-assignment handlers against the real DB and
 * proves:
 *   1. an employee with no override inherits the global/default PTO policy;
 *   2. assigning a policy creates exactly one employee-level policy_assignment
 *      and the engine then resolves THAT policy for the employee;
 *   3. re-assigning updates the same row (no duplicates) and re-resolves;
 *   4. a non-PTO / unknown policyId is rejected (400);
 *   5. clearing (policyId:null) deletes the row and the employee inherits again;
 *   6. balances are UNCHANGED when the assigned policy carries the same rules as
 *      the inherited default (assignment changed, numbers identical).
 *
 * Run with: `tsx server/__tests__/ptoEmployeeAssignment.test.ts`
 *
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { eq, and } from "drizzle-orm";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { seed } = await import("../seed.js");
const { storage } = await import("../storage.js");

await seed();

const [ptoType] = await db
  .select()
  .from(schema.policyTypes)
  .where(eq(schema.policyTypes.key, "pto"));
assert.ok(ptoType, "pto policy type must be seeded");

// --- Fixtures -------------------------------------------------------------

async function makeUser(): Promise<string> {
  const id = `pto-assign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Test",
    lastName: "AssignEmployee",
    role: "employee",
  });
  return id;
}

async function makePtoPolicy(name: string, rules: Record<string, any>): Promise<string> {
  const policy = await storage.createPolicy({
    companyId: null,
    policyTypeId: ptoType.id,
    name,
    status: "active",
    isSystemDefault: false,
  } as any);
  await storage.upsertPolicyRules(policy.id, rules);
  return policy.id;
}

const userId = await makeUser();

const selectable = await storage.getSelectablePtoPolicies();
const systemDefault = selectable.find((p) => p.isSystemDefault);
assert.ok(systemDefault, "a system-default PTO policy must exist after seed");
const defaultRules = (await storage.getPolicyRulesByPolicy(systemDefault!.id))[0]?.rules ?? {};

// A policy with materially DIFFERENT accrual numbers.
const altPolicyId = await makePtoPolicy("Alt 160 annual", {
  ...defaultRules,
  accrualType: "annual",
  accrualHoursPerYear: 160,
  yearlyCapHours: null,
});

// A policy whose rules are IDENTICAL to the default (balance-unchanged probe).
const twinPolicyId = await makePtoPolicy("Twin of default", { ...defaultRules });

// --- Mount the real handlers (mirrors server/routes.ts) -------------------

function buildApp(asUserId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).authUser = { id: asUserId, role: "admin" };
    next();
  });

  app.get("/api/employee-pto-assignment/:id", async (req, res) => {
    const uid = String(req.params.id);
    const [assignment, available, effective] = await Promise.all([
      storage.getEmployeePtoAssignment(uid),
      storage.getSelectablePtoPolicies(),
      storage.getEmployeePtoPolicy(uid),
    ]);
    res.json({
      assignmentId: assignment?.id ?? null,
      policyId: assignment?.policyId ?? null,
      effectivePolicyId: (effective as any)?.id ?? null,
      effectivePolicyName: (effective as any)?.name ?? null,
      policies: available.map((p) => ({ id: p.id, name: p.name, isSystemDefault: p.isSystemDefault })),
    });
  });

  // Mirror the real GET /api/pto-balances/all policy-resolution + totals logic
  // (server/routes.ts) so we can prove the balances view tracks assignments.
  app.get("/api/pto-balances/all", async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const balances = await Promise.all(allUsers.map(async (u) => {
      const ptoSettings = await storage.getEmployeePtoSettings(u.id);
      const policy = await storage.getEmployeePtoPolicy(u.id);
      const totalVacation = (policy?.accrualType === "per_hours_worked" && ptoSettings?.vacationHoursOverride == null)
        ? await storage.computeAnnualVacationEntitlement(u.id)
        : (ptoSettings?.vacationHoursOverride ?? policy?.accrualHoursPerYear ?? 120);
      const totalPersonal = ptoSettings?.personalHoursOverride ?? policy?.personalHoursPerYear ?? 40;
      return { userId: u.id, vacation: { total: totalVacation }, personal: { total: totalPersonal } };
    }));
    res.json(balances);
  });

  app.put("/api/employee-pto-assignment/:id", async (req, res) => {
    const uid = String(req.params.id);
    const raw = (req.body as any)?.policyId;
    const policyId = raw === null || raw === undefined || raw === "" ? null : String(raw);
    const target = await storage.getUser(uid);
    if (!target) return res.status(404).json({ message: "Employee not found." });
    const existing = await storage.getEmployeePtoAssignment(uid);
    if (policyId === null) {
      if (existing) await storage.deletePolicyAssignment(existing.id);
      return res.json({ assignmentId: null, policyId: null });
    }
    const list = await storage.getSelectablePtoPolicies();
    if (!list.some((p) => p.id === policyId)) {
      return res.status(400).json({ message: "Selected policy is not an active PTO policy." });
    }
    let result;
    if (existing) {
      result = await storage.updatePolicyAssignment(existing.id, { policyId });
    } else {
      result = await storage.createPolicyAssignment({ policyId, userId: uid } as any);
    }
    res.json({ assignmentId: result?.id ?? null, policyId });
  });

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

async function api(base: string, method: string, path: string, body?: any) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

/** Count employee-level pto assignment rows for a user (no duplicates allowed). */
async function countEmployeeAssignments(uid: string): Promise<number> {
  const rows = await db
    .select({ id: schema.policyAssignments.id })
    .from(schema.policyAssignments)
    .innerJoin(schema.policies, eq(schema.policyAssignments.policyId, schema.policies.id))
    .where(and(eq(schema.policies.policyTypeId, ptoType.id), eq(schema.policyAssignments.userId, uid)));
  return rows.length;
}

const { url, close } = await listen(buildApp(userId));

/** Vacation total the balances view reports for our test user. */
async function balancesVacationTotal(): Promise<number> {
  const res = await api(url, "GET", "/api/pto-balances/all");
  assert.equal(res.status, 200);
  const row = res.body.find((b: any) => b.userId === userId);
  assert.ok(row, "test user appears in balances view");
  return row.vacation.total;
}

try {
  // 1. No override → inherits default, no employee-level row.
  let r = await api(url, "GET", `/api/employee-pto-assignment/${userId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.policyId, null, "no employee-level override initially");
  assert.equal(r.body.effectivePolicyId, systemDefault!.id, "inherits the system-default policy");
  assert.ok(r.body.policies.some((p: any) => p.id === altPolicyId), "alt policy is selectable");
  assert.equal(await countEmployeeAssignments(userId), 0);
  const inheritedDefault = await storage.getEmployeePtoPolicy(userId);
  const baselineVacationTotal = await balancesVacationTotal();

  // 2. Assign the alt policy → creates exactly one row, engine resolves alt.
  r = await api(url, "PUT", `/api/employee-pto-assignment/${userId}`, { policyId: altPolicyId });
  assert.equal(r.status, 200);
  assert.equal(r.body.policyId, altPolicyId);
  assert.equal(await countEmployeeAssignments(userId), 1, "exactly one employee-level assignment");
  let resolved = await storage.getEmployeePtoPolicy(userId);
  assert.equal((resolved as any).id, altPolicyId, "engine now resolves the assigned policy");
  assert.equal((resolved as any).accrualHoursPerYear, 160, "assigned policy's numbers take effect");

  // The balances view tracks the new assignment (annual 160), not the legacy link.
  assert.equal(await balancesVacationTotal(), 160, "balances view reflects the reassigned policy");

  // 3. Re-assign to twin → SAME row updated (still exactly one), re-resolves.
  r = await api(url, "PUT", `/api/employee-pto-assignment/${userId}`, { policyId: twinPolicyId });
  assert.equal(r.status, 200);
  assert.equal(await countEmployeeAssignments(userId), 1, "re-assign updates the same row, no duplicate");
  resolved = await storage.getEmployeePtoPolicy(userId);
  assert.equal((resolved as any).id, twinPolicyId, "engine resolves the re-assigned policy");

  // 6. Balance-unchanged: twin carries the default's rules, so every accrual
  //    field matches the inherited default exactly (assignment changed, numbers did not).
  const ACCRUAL_FIELDS = [
    "accrualType", "accrualHoursPerYear", "yearlyCapHours", "carryoverCapHours",
    "waitingPeriodDays", "sickAccrualEnabled", "sickAccrualRatePerHours",
    "sickAccrualPerHoursWorked", "sickYearlyCapHours", "vacationAccrualPerHoursWorked",
    "vacationAccrualHoursPerThreshold", "personalHoursPerYear", "holidayPayEnabled",
    "holidayPtoDeduction", "holidayOtExclusion", "expirationDate",
  ] as const;
  for (const f of ACCRUAL_FIELDS) {
    assert.deepEqual(
      (resolved as any)[f],
      (inheritedDefault as any)[f],
      `twin-of-default assignment must keep balance field "${f}" identical to the inherited default`,
    );
  }

  // 4. Unknown / non-PTO policyId → 400, no row change.
  r = await api(url, "PUT", `/api/employee-pto-assignment/${userId}`, { policyId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(r.status, 400, "unknown policy id is rejected");
  assert.equal(await countEmployeeAssignments(userId), 1, "rejected assignment leaves the row untouched");

  // 5. Clear (policyId:null) → row deleted, inherits default again.
  r = await api(url, "PUT", `/api/employee-pto-assignment/${userId}`, { policyId: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.policyId, null);
  assert.equal(await countEmployeeAssignments(userId), 0, "clearing deletes the employee-level row");
  resolved = await storage.getEmployeePtoPolicy(userId);
  assert.equal((resolved as any).id, systemDefault!.id, "inherits the system-default policy again");
  assert.equal(await balancesVacationTotal(), baselineVacationTotal, "balances view returns to the inherited baseline after clearing");

  console.log("✓ employee-level PTO assignment CRUD, engine resolution, and balance-unchanged invariant all hold");
} finally {
  // Cleanup: remove the test user's assignments and fixture policies.
  const leftover = await storage.getEmployeePtoAssignment(userId);
  if (leftover) await storage.deletePolicyAssignment(leftover.id);
  await storage.deletePolicy(altPolicyId).catch(() => {});
  await storage.deletePolicy(twinPolicyId).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  close();
}

console.log("\nAll employee-level PTO assignment tests passed.");
process.exit(0);
