/**
 * Confirmation-only clocking: a fixed-salary employee flagged
 * `clockConfirmationOnly` records ONE self-contained "present" punch per day
 * (closed, 0 hours) rather than an open shift — so hours aren't counted, a single
 * daily clock is never a missing/open punch, and a second clock the same day is a
 * no-op. A normal employee is unaffected.
 *
 * Run with: `npx tsx server/__tests__/clockConfirmationOnly.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs, userEmploymentProfiles } from "@shared/schema";
import { runAutoClockOut } from "../services/policyEnforcement";

const stamp = `confonly-${Date.now().toString(36)}`;

async function makeEmployee(suffix: string, confirmationOnly: boolean) {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-${suffix}@example.invalid`, firstName: "Conf", lastName: `${stamp}${suffix}`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  await db.insert(userEmploymentProfiles).values({
    userId: emp.id, payType: confirmationOnly ? "daily" : "hourly",
    clockConfirmationOnly: confirmationOnly,
  });
  return emp.id;
}
async function cleanup(id: string) {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
  await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id)).catch(() => {});
  await db.delete(users).where(eq(users.id, id)).catch(() => {});
}

test("confirmation-only: one clock records a closed 0-hour 'present' punch, idempotent per day", async (t) => {
  const id = await makeEmployee("c", true);
  t.after(() => cleanup(id));

  const first = await storage.clockIn(id, "biometric");
  assert.equal(first.status, "confirmation", "recorded as a confirmation punch");
  assert.ok(first.clockOut, "closed (not an open shift)");
  assert.equal(Number(first.hoursWorked), 0, "no hours counted");

  // Second clock the same day is a no-op (one present marker per day).
  const second = await storage.clockIn(id, "biometric");
  assert.equal(second.id, first.id, "same-day re-clock returns the existing marker");

  const rows = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(rows.length, 1, "exactly one punch for the day");

  // The missing-punch sweep never touches it (it isn't open).
  await runAutoClockOut();
  const after = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, id));
  assert.equal(after.length, 1, "still one punch");
  assert.equal(after[0].status, "confirmation", "still a confirmation punch, not missing_clockout");
});

test("normal employee is unaffected: clock-in opens an in-progress shift", async (t) => {
  const id = await makeEmployee("n", false);
  t.after(() => cleanup(id));

  const p = await storage.clockIn(id, "web");
  assert.equal(p.status, "in-progress", "normal clock-in is in-progress");
  assert.equal(p.clockOut, null, "open shift (awaiting clock-out)");
});
