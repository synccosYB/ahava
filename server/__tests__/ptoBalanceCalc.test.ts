/**
 * DB-backed coverage for the PTO accrual / balance math in storage.ts:
 *   - computeTimeOffBalanceDetailed (annual + per_hours_worked vacation accrual,
 *     sick accrual + cap, personal allotment, used-hours deduction, carryover,
 *     per-employee overrides, waiting period)
 *   - computeAnnualVacationEntitlement
 *   - computeTotalHoursWorked
 *
 * Each test stands up an isolated employee with an employee-level unified `pto`
 * policy (policies + policy_rules + policy_assignments) so the effective-policy
 * resolver returns exactly the rules under test, then tears it all down.
 *
 * Run with: `npx tsx server/__tests__/ptoBalanceCalc.test.ts`  (requires DATABASE_URL)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../storage";
import { applyPtoAnniversaryAdjustments } from "../services/ptoAnniversary";
import { db } from "../db";
import {
  users,
  punchLogs,
  timeOffRequests,
  timeOffBalances,
  employeePtoSettings,
  ptoAnniversaryAdjustments,
  policies,
  policyRules,
  policyTypes,
  policyAssignments,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const CURRENT_YEAR = new Date().getFullYear();
const createdUserIds: string[] = [];
const createdPolicyIds: string[] = [];

async function ptoPolicyTypeId(): Promise<string> {
  const [pt] = await db.select().from(policyTypes).where(eq(policyTypes.key, "pto"));
  if (pt) return pt.id;
  const [created] = await db
    .insert(policyTypes)
    .values({ key: "pto", name: "PTO", description: "PTO", module: "pto" })
    .returning();
  return created.id;
}

/**
 * Create an employee with an employee-level PTO policy carrying `rules`, plus
 * optional employee_pto_settings overrides. Returns the user id.
 */
async function makeEmployeeWithPto(
  suffix: string,
  rules: Record<string, unknown>,
  settings?: Record<string, unknown>,
): Promise<string> {
  const id = `pto-${suffix}-${stamp}`;
  await db.insert(users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Pto",
    lastName: suffix,
    role: "employee",
    status: "active",
  });
  createdUserIds.push(id);

  const typeId = await ptoPolicyTypeId();
  const [policy] = await db
    .insert(policies)
    .values({
      policyTypeId: typeId,
      name: `PTO ${id}`,
      status: "active",
    })
    .returning();
  createdPolicyIds.push(policy.id);
  await db.insert(policyRules).values({ policyId: policy.id, rules });
  await db.insert(policyAssignments).values({ policyId: policy.id, userId: id });

  if (settings) {
    await db.insert(employeePtoSettings).values({ userId: id, ...(settings as any) });
  }
  return id;
}

async function addPunch(userId: string, workDate: string, hoursWorked: number) {
  await db.insert(punchLogs).values({
    employeeId: userId,
    workDate,
    clockIn: new Date(`${workDate}T09:00:00`),
    clockOut: new Date(`${workDate}T17:00:00`),
    hoursWorked,
    status: "complete",
    source: "test",
    approved: true,
  });
}

async function addTimeOff(
  userId: string,
  type: string,
  startDate: string,
  endDate: string,
  hoursApproved: number,
) {
  await db.insert(timeOffRequests).values({
    userId,
    type,
    requestCategory: "time_off",
    startDate,
    endDate,
    hoursRequested: hoursApproved,
    hoursApproved,
    status: "approved",
  });
}

async function cleanup() {
  if (createdUserIds.length) {
    await db.delete(punchLogs).where(inArray(punchLogs.employeeId, createdUserIds));
    await db.delete(timeOffRequests).where(inArray(timeOffRequests.userId, createdUserIds));
    await db.delete(timeOffBalances).where(inArray(timeOffBalances.userId, createdUserIds));
    await db.delete(ptoAnniversaryAdjustments).where(inArray(ptoAnniversaryAdjustments.employeeId, createdUserIds));
    await db.delete(employeePtoSettings).where(inArray(employeePtoSettings.userId, createdUserIds));
    await db.delete(policyAssignments).where(inArray(policyAssignments.userId, createdUserIds));
  }
  if (createdPolicyIds.length) {
    await db.delete(policyRules).where(inArray(policyRules.policyId, createdPolicyIds));
    await db.delete(policies).where(inArray(policies.id, createdPolicyIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
}

test("annual accrual: vacation total equals accrualHoursPerYear", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("annual", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    personalHoursPerYear: 40,
    carryoverCapHours: 0,
  });
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 120);
  assert.equal(bal.vacation.used, 0);
  assert.equal(bal.vacation.remaining, 120);
  assert.equal(bal.personal.total, 40);
  assert.equal(bal.sick.total, 0);
});

test("used deduction: approved vacation requests reduce the remaining balance", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("used", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    carryoverCapHours: 0,
  });
  await addTimeOff(id, "vacation", `${CURRENT_YEAR}-03-01`, `${CURRENT_YEAR}-03-01`, 8);
  await addTimeOff(id, "vacation", `${CURRENT_YEAR}-04-01`, `${CURRENT_YEAR}-04-02`, 16);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 120);
  assert.equal(bal.vacation.used, 24);
  assert.equal(bal.vacation.remaining, 96);
});

test("per_hours_worked: vacation accrues by floor(hoursWorked / threshold)", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("phw", {
    accrualType: "per_hours_worked",
    vacationAccrualPerHoursWorked: 30,
    vacationAccrualHoursPerThreshold: 1,
    yearlyCapHours: null,
    sickAccrualEnabled: false,
    waitingPeriodDays: 0,
    carryoverCapHours: 0,
  });
  // 125 worked hours → floor(125/30) = 4 vacation hours.
  await addPunch(id, `${CURRENT_YEAR}-01-10`, 40);
  await addPunch(id, `${CURRENT_YEAR}-01-17`, 40);
  await addPunch(id, `${CURRENT_YEAR}-01-24`, 45);
  const entitlement = await storage.computeAnnualVacationEntitlement(id);
  assert.equal(entitlement, 4);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 4);
});

test("per_hours_worked: yearlyCapHours caps the accrued vacation", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("phwcap", {
    accrualType: "per_hours_worked",
    vacationAccrualPerHoursWorked: 30,
    vacationAccrualHoursPerThreshold: 1,
    yearlyCapHours: 3,
    sickAccrualEnabled: false,
    waitingPeriodDays: 0,
    carryoverCapHours: 0,
  });
  // 150 worked → floor(150/30) = 5, capped to 3.
  await addPunch(id, `${CURRENT_YEAR}-02-10`, 50);
  await addPunch(id, `${CURRENT_YEAR}-02-17`, 50);
  await addPunch(id, `${CURRENT_YEAR}-02-24`, 50);
  assert.equal(await storage.computeAnnualVacationEntitlement(id), 3);
});

test("sick accrual: accrues per hours worked and respects the yearly cap", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("sick", {
    accrualType: "annual",
    accrualHoursPerYear: 0,
    sickAccrualEnabled: true,
    sickAccrualPerHoursWorked: 30,
    sickAccrualRatePerHours: 1,
    sickYearlyCapHours: 40,
    carryoverCapHours: 0,
  });
  // 120 worked → floor(120/30)*1 = 4 sick hours (well under the 40 cap).
  await addPunch(id, `${CURRENT_YEAR}-01-10`, 40);
  await addPunch(id, `${CURRENT_YEAR}-01-17`, 40);
  await addPunch(id, `${CURRENT_YEAR}-01-24`, 40);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.sick.total, 4);
});

test("override: vacationHoursOverride wins over policy accrual (no carryover)", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto(
    "override",
    {
      accrualType: "annual",
      accrualHoursPerYear: 120,
      sickAccrualEnabled: false,
      carryoverCapHours: 0,
    },
    { vacationHoursOverride: 200 },
  );
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 200);
  assert.equal(await storage.computeAnnualVacationEntitlement(id), 200);
});

test("waiting period: a brand-new hire inside the waiting window has zero balances", async (t) => {
  t.after(cleanup);
  const today = new Date().toISOString().split("T")[0];
  const id = await makeEmployeeWithPto(
    "waiting",
    {
      accrualType: "annual",
      accrualHoursPerYear: 120,
      sickAccrualEnabled: true,
      waitingPeriodDays: 90,
      carryoverCapHours: 0,
    },
    { hireDate: today },
  );
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 0);
  assert.equal(bal.sick.total, 0);
  assert.equal(bal.personal.total, 0);
  assert.equal(await storage.computeAnnualVacationEntitlement(id), 0);
});

test("computeTotalHoursWorked: sums punch hours within the year", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("hours", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    carryoverCapHours: 0,
  });
  await addPunch(id, `${CURRENT_YEAR}-05-01`, 8);
  await addPunch(id, `${CURRENT_YEAR}-05-02`, 7.5);
  // A prior-year punch must NOT be counted.
  await addPunch(id, `${CURRENT_YEAR - 1}-12-31`, 8);
  const total = await storage.computeTotalHoursWorked(id, CURRENT_YEAR);
  assert.equal(total, 15.5);
});

test("holiday PTO deduction: approved holiday hours reduce the annual vacation total", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("holiday", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    holidayPayEnabled: true,
    holidayPtoDeduction: true,
    carryoverCapHours: 0,
  });
  // An 8h holiday request this year must come OUT of the 120h annual vacation.
  await addTimeOff(id, "holiday", `${CURRENT_YEAR}-07-04`, `${CURRENT_YEAR}-07-04`, 8);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 112);
  // A holiday request is NOT a vacation request, so "used vacation" stays 0.
  assert.equal(bal.vacation.used, 0);
  assert.equal(bal.vacation.remaining, 112);
});

test("carryover cap: unused prior-year vacation rolls over but is capped", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("carryover", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    carryoverCapHours: 40,
  });
  // Prior year: 120 accrued, 20 used → 100 remaining. Carryover is capped at 40,
  // so this year's total = 120 (fresh) + 40 (capped carryover) = 160.
  await addTimeOff(id, "vacation", `${CURRENT_YEAR - 1}-03-01`, `${CURRENT_YEAR - 1}-03-03`, 20);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 160);
});

test("carryover cap: prior-year remainder below the cap rolls over in full", async (t) => {
  t.after(cleanup);
  const id = await makeEmployeeWithPto("carryunder", {
    accrualType: "annual",
    accrualHoursPerYear: 120,
    sickAccrualEnabled: false,
    carryoverCapHours: 40,
  });
  // Prior year: 120 accrued, 100 used → 20 remaining (< 40 cap) → rolls over fully.
  await addTimeOff(id, "vacation", `${CURRENT_YEAR - 1}-02-01`, `${CURRENT_YEAR - 1}-02-15`, 100);
  const bal = await storage.computeTimeOffBalanceDetailed(id);
  assert.equal(bal.vacation.total, 140);
});

/**
 * CONFIRMED BUG (characterization test — do NOT "fix" the assertions to expect a
 * persisted row; fix the production code in a follow-up instead).
 *
 * `applyPtoAnniversaryAdjustments` (server/services/ptoAnniversary.ts) computes the
 * tier transition correctly — an employee crossing from the 80h tier to the 120h
 * tier on their 3-year anniversary should gain +40h. BUT it then writes the row
 * with `ptoPolicyId: effective.policyId`, where `effective.policyId` is a UNIFIED
 * policy-engine `policies.id`, while `pto_anniversary_adjustments.pto_policy_id`
 * has a foreign key to the LEGACY `pto_policies.id`. Since PTO resolves through the
 * unified engine today, that id never exists in `pto_policies`, so the INSERT
 * raises a FK violation that is swallowed into `result.errors`. Net effect: the
 * anniversary raise is NEVER persisted (no adjustment row, no balance grant) for
 * any engine-resolved PTO policy.
 *
 * This test pins that broken behavior so a future fix (which should make the row
 * persist and the balance increment by 40h) trips this test and forces the
 * assertions to be updated alongside the fix.
 */
test("anniversary tier: engine-resolved PTO policy fails to persist the tier raise (CONFIRMED BUG)", async (t) => {
  t.after(cleanup);
  // Hire date == today's month/day, three years ago → today is the 3-year anniversary.
  const today = new Date();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const hireDate = `${today.getUTCFullYear() - 3}-${mm}-${dd}`;
  const id = await makeEmployeeWithPto(
    "anniv",
    {
      accrualType: "annual",
      accrualHoursPerYear: 80,
      sickAccrualEnabled: false,
      carryoverCapHours: 0,
      anniversaryTiers: [
        { yearsOfService: 0, accrualRate: 80, tierLabel: "Year 0" },
        { yearsOfService: 3, accrualRate: 120, tierLabel: "Year 3" },
      ],
    },
    { hireDate },
  );

  const result = await applyPtoAnniversaryAdjustments();
  assert.ok(result.processed >= 1, "the sweep should process at least our employee");

  // The tier math fires, but persistence fails on the FK mismatch and is captured
  // as an error for our employee rather than crashing the sweep.
  const ourError = result.errors.find((e) => e.startsWith(`${id}:`));
  assert.ok(
    ourError && /pto_policy_id|foreign key/i.test(ourError),
    `expected a swallowed FK error for ${id}, got: ${JSON.stringify(result.errors)}`,
  );

  // Because the insert failed, NO adjustment row and NO balance grant are persisted.
  const adj = await db
    .select()
    .from(ptoAnniversaryAdjustments)
    .where(eq(ptoAnniversaryAdjustments.employeeId, id));
  assert.equal(adj.length, 0, "no anniversary adjustment is persisted (bug)");

  const bal = await db
    .select()
    .from(timeOffBalances)
    .where(eq(timeOffBalances.userId, id));
  assert.equal(bal.length, 0, "no vacation balance grant is persisted (bug)");
});
