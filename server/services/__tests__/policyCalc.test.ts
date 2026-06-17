/**
 * Pure-logic coverage for the attendance/payroll policy-enforcement math that
 * has no DB dependency: time rounding, clock-out overtime / double-time / break
 * enforcement, auto-clock-out value computation, and PTO advance-notice /
 * blackout-date enforcement.
 *
 * These complement the bonus tests in `policyEnforcement.test.ts`. Together they
 * cover every branch of the pure functions exported from
 * `server/services/policyEnforcement.ts` except the DB-touching
 * `enforceClockIn` / `runAutoClockOut` / `createPolicyAlert(s)` helpers (those
 * are exercised by the DB-backed clock and integration tests).
 *
 * Run with: `npx tsx server/services/__tests__/policyCalc.test.ts`
 * (no DATABASE_URL required).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roundTime,
  enforceClockOut,
  computeAutoClockOutValues,
  enforcePtoAdvanceNotice,
  enforcePtoBlackoutDates,
} from "../policyEnforcement";
import type { User } from "@shared/schema";

// Work in UTC so 15-minute rounding lands on predictable :00/:15/:30/:45
// boundaries (roundTime rounds against the absolute epoch).
const utc = (h: number, m: number) => new Date(Date.UTC(2025, 0, 15, h, m, 0, 0));
const minutesUtc = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

const fakeUser = { id: "emp-1" } as unknown as User;

// --- roundTime -------------------------------------------------------------

test("roundTime: nearest_15 rounds down when under the half-interval", () => {
  // :07 is closer to :00 than :15
  assert.equal(minutesUtc(roundTime(utc(9, 7), "nearest_15", 15)), 9 * 60 + 0);
});

test("roundTime: nearest_15 rounds up when past the half-interval", () => {
  // :08 is closer to :15
  assert.equal(minutesUtc(roundTime(utc(9, 8), "nearest_15", 15)), 9 * 60 + 15);
});

test("roundTime: nearest honors a custom interval (5 min)", () => {
  assert.equal(minutesUtc(roundTime(utc(9, 13), "nearest", 5)), 9 * 60 + 15);
});

test("roundTime: round_up always ceils to the interval", () => {
  assert.equal(minutesUtc(roundTime(utc(9, 1), "round_up", 15)), 9 * 60 + 15);
  // Already on a boundary stays put.
  assert.equal(minutesUtc(roundTime(utc(9, 0), "round_up", 15)), 9 * 60 + 0);
});

test("roundTime: round_down always floors to the interval", () => {
  assert.equal(minutesUtc(roundTime(utc(9, 14), "round_down", 15)), 9 * 60 + 0);
  assert.equal(minutesUtc(roundTime(utc(9, 29), "round_down", 15)), 9 * 60 + 15);
});

test("roundTime: 'none' and unknown rules return the original instant", () => {
  const d = utc(9, 7);
  assert.equal(roundTime(d, "none", 15).getTime(), d.getTime());
  assert.equal(roundTime(d, "whatever", 15).getTime(), d.getTime());
});

test("roundTime: non-positive interval is a no-op", () => {
  const d = utc(9, 7);
  assert.equal(roundTime(d, "nearest_15", 0).getTime(), d.getTime());
  assert.equal(roundTime(d, "nearest_15", -15).getTime(), d.getTime());
});

// --- enforceClockOut -------------------------------------------------------

const attRules = {
  roundingRule: "none", // keep clock-out instant exact so hours math is clean
  roundingIntervalMinutes: 15,
  otThresholdDaily: 8,
  requireBreakAfterHours: 6,
  breakDurationMinutes: 30,
};
const payRules = {
  overtimeMultiplier: 1.5,
  doubleTimeMultiplier: 2.0,
  doubleTimeThresholdDaily: 12,
  overtimeEnabled: true,
  doubleTimeEnabled: true,
  autoCalculateOT: true,
};

test("enforceClockOut: plain 8h shift is complete with no overtime", () => {
  const r = enforceClockOut(utc(9, 0), utc(17, 30), 30, attRules, payRules, fakeUser);
  assert.equal(r.hoursWorked, 8); // 8.5h elapsed minus 0.5h break
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.doubleTimeHours, 0);
  assert.equal(r.status, "complete");
});

test("enforceClockOut: between OT and DT thresholds yields only overtime", () => {
  // 10h elapsed, no break → 10h worked; OT 8, DT 12.
  const r = enforceClockOut(utc(8, 0), utc(18, 0), 0, attRules, payRules, fakeUser);
  assert.equal(r.hoursWorked, 10);
  assert.equal(r.overtimeHours, 2);
  assert.equal(r.doubleTimeHours, 0);
  assert.equal(r.status, "overtime");
});

test("enforceClockOut: beyond DT threshold splits OT and double-time", () => {
  // 13h worked → DT = 13-12 = 1, OT = 12-8 = 4.
  const r = enforceClockOut(utc(6, 0), utc(19, 0), 0, attRules, payRules, fakeUser);
  assert.equal(r.hoursWorked, 13);
  assert.equal(r.overtimeHours, 4);
  assert.equal(r.doubleTimeHours, 1);
  assert.equal(r.status, "overtime");
});

test("enforceClockOut: overtimeEnabled=false suppresses all OT/DT", () => {
  const r = enforceClockOut(
    utc(6, 0),
    utc(19, 0),
    0,
    attRules,
    { ...payRules, overtimeEnabled: false },
    fakeUser,
  );
  assert.equal(r.hoursWorked, 13);
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.doubleTimeHours, 0);
  assert.equal(r.status, "complete");
});

test("enforceClockOut: doubleTimeEnabled=false keeps all excess as overtime", () => {
  const r = enforceClockOut(
    utc(6, 0),
    utc(19, 0),
    0,
    attRules,
    { ...payRules, doubleTimeEnabled: false },
    fakeUser,
  );
  assert.equal(r.hoursWorked, 13);
  assert.equal(r.overtimeHours, 5); // 13 - 8, no DT carve-out
  assert.equal(r.doubleTimeHours, 0);
});

test("enforceClockOut: autoCalculateOT=false disables the OT engine entirely", () => {
  const r = enforceClockOut(
    utc(6, 0),
    utc(19, 0),
    0,
    attRules,
    { ...payRules, autoCalculateOT: false },
    fakeUser,
  );
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.doubleTimeHours, 0);
  assert.equal(r.status, "complete");
});

test("enforceClockOut: long shift without a break raises a break_violation alert", () => {
  // 9h shift, 0 break, requireBreakAfterHours=6.
  const r = enforceClockOut(utc(8, 0), utc(17, 0), 0, attRules, payRules, fakeUser);
  const breakAlert = r.alerts.find((a) => a.type === "break_violation");
  assert.ok(breakAlert, "expected a break_violation alert");
});

test("enforceClockOut: a sufficient break suppresses the break_violation alert", () => {
  const r = enforceClockOut(utc(8, 0), utc(17, 0), 30, attRules, payRules, fakeUser);
  assert.equal(r.alerts.find((a) => a.type === "break_violation"), undefined);
});

// --- computeAutoClockOutValues --------------------------------------------

test("computeAutoClockOutValues: caps the shift at autoClockOutAfterHours", () => {
  const actualClockIn = utc(8, 0);
  const r = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn: actualClockIn,
    breakMinutes: 0,
    autoClockOutAfterHours: 16,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(
    r.autoClockOutActual.getTime(),
    actualClockIn.getTime() + 16 * 60 * 60 * 1000,
  );
  assert.equal(r.hoursWorked, 16);
});

test("computeAutoClockOutValues: subtracts break minutes from the capped hours", () => {
  const actualClockIn = utc(8, 0);
  const r = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn: actualClockIn,
    breakMinutes: 60,
    autoClockOutAfterHours: 16,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(r.hoursWorked, 15); // 16h - 1h break
});

test("computeAutoClockOutValues: falls back to actual clock-in when rounded is null", () => {
  const actualClockIn = utc(8, 7);
  const r = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn: null,
    breakMinutes: 0,
    autoClockOutAfterHours: 8,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });
  assert.equal(r.hoursWorked, 8);
});

// --- enforcePtoAdvanceNotice ----------------------------------------------

function isoDaysFromToday(days: number): string {
  const todayStr = new Date().toISOString().split("T")[0];
  const ms = new Date(todayStr + "T00:00:00Z").getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().split("T")[0];
}

test("enforcePtoAdvanceNotice: allowed when no advance-notice rule is set", () => {
  assert.equal(enforcePtoAdvanceNotice(isoDaysFromToday(0), {}).allowed, true);
  assert.equal(
    enforcePtoAdvanceNotice(isoDaysFromToday(0), { advanceNoticeDays: 0 }).allowed,
    true,
  );
});

test("enforcePtoAdvanceNotice: allowed when request is far enough out", () => {
  const r = enforcePtoAdvanceNotice(isoDaysFromToday(10), { advanceNoticeDays: 7 });
  assert.equal(r.allowed, true);
});

test("enforcePtoAdvanceNotice: rejected when inside the notice window", () => {
  const r = enforcePtoAdvanceNotice(isoDaysFromToday(2), { advanceNoticeDays: 7 });
  assert.equal(r.allowed, false);
  assert.match(r.rejectionMessage ?? "", /advance notice/);
});

// --- enforcePtoBlackoutDates ----------------------------------------------

test("enforcePtoBlackoutDates: allowed when no blackout dates configured", () => {
  assert.equal(enforcePtoBlackoutDates("2025-07-01", "2025-07-05", {}).allowed, true);
});

test("enforcePtoBlackoutDates: rejected when a blackout falls inside the range", () => {
  const r = enforcePtoBlackoutDates("2025-07-01", "2025-07-05", {
    blackoutDates: ["2025-07-03"],
  });
  assert.equal(r.allowed, false);
  assert.match(r.rejectionMessage ?? "", /blackout/);
});

test("enforcePtoBlackoutDates: allowed when blackout is outside the range", () => {
  const r = enforcePtoBlackoutDates("2025-07-01", "2025-07-05", {
    blackoutDates: ["2025-07-09"],
  });
  assert.equal(r.allowed, true);
});

test("enforcePtoBlackoutDates: boundary dates (start/end) count as overlapping", () => {
  assert.equal(
    enforcePtoBlackoutDates("2025-07-01", "2025-07-05", { blackoutDates: ["2025-07-01"] })
      .allowed,
    false,
  );
  assert.equal(
    enforcePtoBlackoutDates("2025-07-01", "2025-07-05", { blackoutDates: ["2025-07-05"] })
      .allowed,
    false,
  );
});
