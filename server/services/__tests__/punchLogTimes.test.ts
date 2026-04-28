import { test } from "node:test";
import assert from "node:assert/strict";
import { roundTime, enforceClockOut, computeAutoClockOutValues } from "../policyEnforcement";
import { DEFAULT_PAYROLL_RULES } from "../../policyEngine";
import type { User } from "@shared/schema";

const fakeUser = { id: "u1" } as unknown as User;
test("roundTime rounds to nearest 15 minutes", () => {
  // 12:06 -> 12:00 (closer to 12:00 than 12:15)
  const at1206 = new Date(2026, 3, 21, 12, 6, 0, 0);
  const rounded = roundTime(at1206, "nearest_15", 15);
  assert.equal(rounded.getMinutes(), 0);
  assert.equal(rounded.getHours(), 12);
});

test("roundTime with rule 'none' returns the same instant", () => {
  const at1207 = new Date(2026, 3, 21, 12, 7, 30, 0);
  const rounded = roundTime(at1207, "none", 15);
  assert.equal(rounded.getTime(), at1207.getTime());
});

test("enforceClockOut computes hoursWorked from rounded times, not actual punch moment", () => {
  // Employee actually clocked in at 12:07 PM. Rounded clock-in (15-min nearest) = 12:00 PM.
  // They clock out at 4:23 PM. Rounded clock-out = 4:30 PM. Expected 4.5h, not ~4.27h.
  const roundedClockIn = new Date(2026, 3, 21, 12, 0, 0, 0);
  const actualClockOut = new Date(2026, 3, 21, 16, 23, 0, 0);

  const result = enforceClockOut(
    roundedClockIn,
    actualClockOut,
    0,
    { roundingRule: "nearest_15", roundingIntervalMinutes: 15, otThresholdDaily: 8 },
    DEFAULT_PAYROLL_RULES,
    fakeUser,
  );

  assert.equal(result.roundedTime.getHours(), 16);
  assert.equal(result.roundedTime.getMinutes(), 30);
  assert.equal(result.hoursWorked, 4.5);
  assert.equal(result.status, "complete");
});

test("computeAutoClockOutValues caps clockOut at threshold and uses rounded clock-in for hoursWorked", () => {
  // Actual clock-in 8:07 AM; rounded clock-in 8:00 AM. Auto clock-out after 16h.
  const actualClockIn = new Date(2026, 3, 21, 8, 7, 0, 0);
  const roundedClockIn = new Date(2026, 3, 21, 8, 0, 0, 0);

  const out = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn,
    breakMinutes: 0,
    autoClockOutAfterHours: 16,
    roundingRule: "nearest_15",
    roundingIntervalMinutes: 15,
  });

  // Actual auto clock-out = 8:07 + 16h = 12:07 AM next day.
  assert.equal(out.autoClockOutActual.getTime(), actualClockIn.getTime() + 16 * 3600 * 1000);
  // Rounded auto clock-out = nearest 15 min to 12:07 AM = 12:00 AM next day.
  const expectedRounded = new Date(2026, 3, 22, 0, 0, 0, 0);
  assert.equal(out.autoClockOutRounded.getTime(), expectedRounded.getTime());
  // hoursWorked computed from rounded times: 8:00 AM to 12:00 AM next day = 16h.
  assert.equal(out.hoursWorked, 16);
});

test("computeAutoClockOutValues subtracts break minutes from rounded interval", () => {
  const actualClockIn = new Date(2026, 3, 21, 9, 3, 0, 0);
  const roundedClockIn = new Date(2026, 3, 21, 9, 0, 0, 0);

  const out = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn,
    breakMinutes: 30,
    autoClockOutAfterHours: 16,
    roundingRule: "nearest_15",
    roundingIntervalMinutes: 15,
  });

  // 16h - 30min break = 15.5h
  assert.equal(out.hoursWorked, 15.5);
});

test("computeAutoClockOutValues falls back to actual clock-in when roundedClockIn is null", () => {
  const actualClockIn = new Date(2026, 3, 21, 9, 0, 0, 0);

  const out = computeAutoClockOutValues({
    actualClockIn,
    roundedClockIn: null,
    breakMinutes: 0,
    autoClockOutAfterHours: 8,
    roundingRule: "none",
    roundingIntervalMinutes: 15,
  });

  assert.equal(out.hoursWorked, 8);
});

test("exception approval honors a non-default daily overtime threshold (regression for hard-coded 8h)", () => {
  // A company policy raises the daily overtime threshold from 8h to 10h.
  // When a manager approves a forgotten clock-out for a 9h shift, the
  // resulting punch must be 'complete' (not 'overtime') because 9h is below
  // the configured 10h threshold. This mirrors the math the
  // POST /api/attendance/exceptions/:id/resolve route now performs by
  // delegating to enforceClockOut instead of using a hard-coded 8h check.
  const roundedClockIn = new Date(2026, 3, 21, 8, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 17, 0, 0, 0);

  const customAttendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 10,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    customAttendanceRules,
    DEFAULT_PAYROLL_RULES,
    fakeUser,
    "Custom 10h-OT Policy",
  );

  assert.equal(enforcement.hoursWorked, 9);
  assert.equal(enforcement.status, "complete");
  assert.equal(enforcement.overtimeHours, 0);
  assert.equal(enforcement.doubleTimeHours, 0);
});

test("exception approval splits overtime/double-time using the configured policy thresholds", () => {
  // Custom policy: OT after 10h, double-time after 13h. A corrected 14h shift
  // should yield 3h OT (10h -> 13h) and 1h double-time (13h -> 14h).
  const roundedClockIn = new Date(2026, 3, 21, 6, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 20, 0, 0, 0);

  const customAttendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 10,
  };
  const customPayrollRules = {
    ...DEFAULT_PAYROLL_RULES,
    doubleTimeThresholdDaily: 13,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    customAttendanceRules,
    customPayrollRules,
    fakeUser,
  );

  assert.equal(enforcement.hoursWorked, 14);
  assert.equal(enforcement.status, "overtime");
  assert.equal(enforcement.overtimeHours, 3);
  assert.equal(enforcement.doubleTimeHours, 1);
});
