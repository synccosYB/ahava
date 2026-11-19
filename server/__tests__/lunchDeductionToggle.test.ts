/**
 * Global "Lunch Deduction" switch (attendance rule lunchDeductionEnabled).
 * When OFF, a lunch-required employee who works straight through is NOT docked
 * the 45-minute lunch — but the paid-break rules still apply. Default (ON) keeps
 * docking, covered by lunchBreakLedger.test.ts.
 *
 * Run with: `npx tsx server/__tests__/lunchDeductionToggle.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, punchLogs, userEmploymentProfiles, policyTypes, policies, policyAssignments, policyRules } from "@shared/schema";
import { storage } from "../storage";
import { getLedgerForEmployee } from "../attendanceLedger";

const D = (s: string) => new Date(s);
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: got ${a}, want ${b}`);
const now = D("2026-11-06T23:00:00Z");

test("lunchDeductionEnabled=false: a lunch-required straight-through shift is NOT docked", async (t) => {
  const [attType] = await db.select().from(policyTypes).where(eq(policyTypes.key, "attendance"));
  assert.ok(attType, "attendance policy type must be seeded");

  const u = (await db.insert(users).values({
    email: `lunch-toggle-${Date.now()}@example.invalid`, firstName: "Lunch", lastName: "Toggle", role: "employee",
  }).returning())[0];
  await db.insert(userEmploymentProfiles).values({
    userId: u.id, payType: "hourly", hourlyRate: 20, requireLunchBreak: true,
  });
  // Attendance policy assigned to this employee with the deduction turned OFF.
  const policy = await storage.createPolicy({
    companyId: null, policyTypeId: attType.id, name: `No-lunch-fine ${Date.now()}`, status: "active", isSystemDefault: false,
  } as any);
  await storage.upsertPolicyRules(policy.id, { lunchDeductionEnabled: false });
  await storage.createPolicyAssignment({ policyId: policy.id, userId: u.id } as any);

  t.after(async () => {
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, u.id)).catch(() => {});
    await db.delete(policyAssignments).where(eq(policyAssignments.policyId, policy.id)).catch(() => {});
    await db.delete(policyRules).where(eq(policyRules.policyId, policy.id)).catch(() => {});
    await db.delete(policies).where(eq(policies.id, policy.id)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, u.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, u.id)).catch(() => {});
  });

  // One 9-17 straight-through shift (8h, no lunch). With the fine ON this would
  // be 7.25h; with the global deduction OFF it stays a full 8h.
  await db.insert(punchLogs).values([
    { employeeId: u.id, workDate: "2026-11-05", clockIn: D("2026-11-05T09:00:00Z"), clockOut: D("2026-11-05T17:00:00Z"), roundedClockIn: D("2026-11-05T09:00:00Z"), roundedClockOut: D("2026-11-05T17:00:00Z"), hoursWorked: 8, status: "complete", approved: true },
  ]);
  const ledger = await getLedgerForEmployee(u, "2026-11-05", "2026-11-05", now);
  const day = ledger.find((d) => d.workDate === "2026-11-05");
  assert.ok(day, "ledger day present");
  near(day!.totalHours, 8, "no 45-min deduction when the global switch is off");
});
