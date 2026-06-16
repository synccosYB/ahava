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

test("roundTime honors a 1-minute interval (no effective rounding) for the nearest family", () => {
  // Regression for task #440: an admin sets the interval to 1 minute. The
  // nearest-family rules must respect that instead of snapping to 15.
  const at1405 = new Date(2026, 3, 21, 14, 5, 0, 0);
  // Legacy default method value still present on most policies.
  const roundedLegacy = roundTime(at1405, "nearest_15", 1);
  assert.equal(roundedLegacy.getHours(), 14);
  assert.equal(roundedLegacy.getMinutes(), 5);
  // Canonical "nearest" method behaves identically.
  const roundedCanonical = roundTime(at1405, "nearest", 1);
  assert.equal(roundedCanonical.getTime(), at1405.getTime());
});

test("enforceClockOut with interval=1 records exact minutes (2:05 in / 2:24 out = 0h 19m)", () => {
  // The reported bug: a 19-minute shift was recorded as 0h 30m because the
  // interval was ignored and times snapped to the 15-minute grid.
  const clockIn = new Date(2026, 3, 21, 14, 5, 0, 0);
  const clockOut = new Date(2026, 3, 21, 14, 24, 0, 0);

  const result = enforceClockOut(
    clockIn,
    clockOut,
    0,
    { roundingRule: "nearest", roundingIntervalMinutes: 1, otThresholdDaily: 8 },
    DEFAULT_PAYROLL_RULES,
    fakeUser,
  );

  assert.equal(result.roundedTime.getHours(), 14);
  assert.equal(result.roundedTime.getMinutes(), 24);
  // 19 minutes = 0.32h after rounding to two decimals.
  assert.equal(result.hoursWorked, 0.32);
});

test("default nearest_15 rounding is preserved when no interval override is set", () => {
  // Existing policies left at the 15-minute default must keep snapping to 15.
  const clockOut = roundTime(new Date(2026, 3, 21, 16, 23, 0, 0), "nearest_15", 15);
  assert.equal(clockOut.getHours(), 16);
  assert.equal(clockOut.getMinutes(), 30);
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

test("legacy payroll rules with no enabled flags still compute OT and double-time exactly as before", () => {
  // Regression for task #146: payroll policies saved before per-rule on/off
  // toggles existed have no `overtimeEnabled` / `doubleTimeEnabled` fields.
  // The engine must treat missing flags as `true` so existing customers see
  // identical results.
  const roundedClockIn = new Date(2026, 3, 21, 6, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 22, 0, 0, 0); // 16h shift

  const attendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 8,
  };
  // Intentionally no `overtimeEnabled` / `doubleTimeEnabled` keys here.
  const legacyPayrollRules = {
    overtimeMultiplier: 1.5,
    doubleTimeMultiplier: 2.0,
    doubleTimeThresholdDaily: 12,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    attendanceRules,
    legacyPayrollRules,
    fakeUser,
  );

  assert.equal(enforcement.hoursWorked, 16);
  assert.equal(enforcement.status, "overtime");
  // 8h -> 12h = 4h OT, 12h -> 16h = 4h double-time (legacy default behavior).
  assert.equal(enforcement.overtimeHours, 4);
  assert.equal(enforcement.doubleTimeHours, 4);
});

test("payroll Overtime turned off pays everything at straight time", () => {
  // 16h shift, attendance OT threshold 8h, but Overtime rule explicitly off.
  // Expectation: status stays 'complete' and no OT/DT hours accrue, even
  // though the worker went well past the daily threshold.
  const roundedClockIn = new Date(2026, 3, 21, 6, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 22, 0, 0, 0);

  const attendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 8,
  };
  const payrollRules = {
    ...DEFAULT_PAYROLL_RULES,
    overtimeEnabled: false,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    attendanceRules,
    payrollRules,
    fakeUser,
  );

  assert.equal(enforcement.hoursWorked, 16);
  assert.equal(enforcement.status, "complete");
  assert.equal(enforcement.overtimeHours, 0);
  assert.equal(enforcement.doubleTimeHours, 0);
});

test("payroll Double-time turned off keeps OT but skips the double-time tier", () => {
  // 16h shift, OT after 8h, double-time tier explicitly off. Expect all 8
  // overtime hours to accrue at the OT multiplier with zero double-time
  // hours, instead of splitting 4h OT + 4h DT.
  const roundedClockIn = new Date(2026, 3, 21, 6, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 22, 0, 0, 0);

  const attendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 8,
  };
  const payrollRules = {
    ...DEFAULT_PAYROLL_RULES,
    doubleTimeEnabled: false,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    attendanceRules,
    payrollRules,
    fakeUser,
  );

  assert.equal(enforcement.hoursWorked, 16);
  assert.equal(enforcement.status, "overtime");
  assert.equal(enforcement.overtimeHours, 8);
  assert.equal(enforcement.doubleTimeHours, 0);
});

test("payroll Auto-Calculate Overtime turned off skips OT/DT auto-computation entirely", () => {
  // 16h shift well past every threshold, but autoCalculateOT explicitly off.
  // Expectation: no OT/DT auto-calculated; status remains 'complete'.
  const roundedClockIn = new Date(2026, 3, 21, 6, 0, 0, 0);
  const correctedClockOut = new Date(2026, 3, 21, 22, 0, 0, 0);

  const attendanceRules = {
    roundingRule: "none",
    roundingIntervalMinutes: 15,
    otThresholdDaily: 8,
  };
  const payrollRules = {
    ...DEFAULT_PAYROLL_RULES,
    autoCalculateOT: false,
  };

  const enforcement = enforceClockOut(
    roundedClockIn,
    correctedClockOut,
    0,
    attendanceRules,
    payrollRules,
    fakeUser,
  );

  assert.equal(enforcement.hoursWorked, 16);
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
