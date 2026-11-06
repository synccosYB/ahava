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
import { buildEmployeeTimesheet } from "../timesheetService";

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

test("confirmation-only: the Review Time Sheet shows 'Attendance captured', never missing/in-progress", async (t) => {
  const id = await makeEmployee("ts", true);
  t.after(() => cleanup(id));
  const emp = await storage.getUser(id);
  assert.ok(emp, "employee loaded");

  // Day 1: a proper confirmation marker (closed 0-hour punch).
  await storage.clockIn(id, "biometric", undefined, { at: new Date("2026-11-02T14:00:00Z"), workDate: "2026-11-02" });
  // Day 2: a LEGACY open clock-in (recorded before the toggle, or via a path
  // that left it open) — must still read as "Attendance captured", not missing.
  await db.insert(punchLogs).values({
    employeeId: id, workDate: "2026-11-03",
    clockIn: new Date("2026-11-03T14:00:00Z"), clockOut: null,
    roundedClockIn: new Date("2026-11-03T14:00:00Z"),
    hoursWorked: null, status: "in-progress", source: "web", approved: true,
  });

  const sheet = await buildEmployeeTimesheet(emp!, "2026-11-02", "2026-11-03", new Date("2026-11-06T18:00:00Z"));
  const byDate = new Map(sheet.entries.map((e) => [e.date, e]));
  for (const d of ["2026-11-02", "2026-11-03"]) {
    const row = byDate.get(d);
    assert.ok(row, `row for ${d}`);
    assert.equal(row!.status, "confirmation", `${d} is Attendance captured`);
    assert.equal(row!.totalHours, null, `${d} counts no hours`);
  }
});

test("normal employee's timesheet still flags an open/forgotten punch", async (t) => {
  const id = await makeEmployee("tsn", false);
  t.after(() => cleanup(id));
  const emp = await storage.getUser(id);
  // An open clock-in from days ago (past the max shift) is a missing punch.
  await db.insert(punchLogs).values({
    employeeId: id, workDate: "2026-11-02",
    clockIn: new Date("2026-11-02T14:00:00Z"), clockOut: null,
    roundedClockIn: new Date("2026-11-02T14:00:00Z"),
    hoursWorked: null, status: "in-progress", source: "web", approved: true,
  });
  const sheet = await buildEmployeeTimesheet(emp!, "2026-11-02", "2026-11-02", new Date("2026-11-06T18:00:00Z"));
  const row = sheet.entries.find((e) => e.date === "2026-11-02");
  assert.ok(row, "row present");
  assert.notEqual(row!.status, "confirmation", "normal employee is never 'confirmation'");
  assert.equal(row!.status, "missing_punch", "a days-old open punch is a missing punch");
});

test("normal employee is unaffected: clock-in opens an in-progress shift", async (t) => {
  const id = await makeEmployee("n", false);
  t.after(() => cleanup(id));

  const p = await storage.clockIn(id, "web");
  assert.equal(p.status, "in-progress", "normal clock-in is in-progress");
  assert.equal(p.clockOut, null, "open shift (awaiting clock-out)");
});
