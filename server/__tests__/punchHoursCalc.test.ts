/**
 * Pure-logic coverage for the hours-engine and PTO-policy-builder math that
 * underpins every attendance/payroll total:
 *   - computePunchHoursWorked (server/punchHours.ts) — the single source of
 *     truth for a punch's derived hours_worked.
 *   - computeAttendanceTotals (server/timesheetService.ts) — the aggregate the
 *     time report and per-employee timesheet share.
 *   - buildPtoPolicyFromRules / getDefaultRulesForType (server/policyEngine.ts)
 *     — the synthetic-policy builder PTO accrual resolves through.
 *
 * Run with: `npx tsx server/__tests__/punchHoursCalc.test.ts`
 * (no DATABASE_URL required — these never touch the DB).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePunchHoursWorked } from "../punchHours";
import { computeAttendanceTotals } from "../timesheetService";
import {
  buildPtoPolicyFromRules,
  getDefaultRulesForType,
  DEFAULT_PTO_RULES,
  DEFAULT_ATTENDANCE_RULES,
  DEFAULT_PAYROLL_RULES,
} from "../policyEngine";
import type { PunchLog } from "@shared/schema";

const iso = (h: number, m = 0) =>
  new Date(Date.UTC(2025, 0, 15, h, m, 0, 0)).toISOString();

// --- computePunchHoursWorked ----------------------------------------------

test("computePunchHoursWorked: simple full shift", () => {
  const h = computePunchHoursWorked({ clockIn: iso(9), clockOut: iso(17) });
  assert.equal(h, 8);
});

test("computePunchHoursWorked: subtracts break minutes", () => {
  const h = computePunchHoursWorked({
    clockIn: iso(9),
    clockOut: iso(17, 30),
    breakMinutes: 30,
  });
  assert.equal(h, 8);
});

test("computePunchHoursWorked: prefers rounded times over actual", () => {
  // actual 9:07 → 17:07 (8h) but rounded 9:00 → 17:30 (8.5h) wins.
  const h = computePunchHoursWorked({
    clockIn: iso(9, 7),
    clockOut: iso(17, 7),
    roundedClockIn: iso(9, 0),
    roundedClockOut: iso(17, 30),
  });
  assert.equal(h, 8.5);
});

test("computePunchHoursWorked: rounds to two decimals", () => {
  // 7h 40m = 7.666... → 7.67
  const h = computePunchHoursWorked({ clockIn: iso(9), clockOut: iso(16, 40) });
  assert.equal(h, 7.67);
});

test("computePunchHoursWorked: null when no clock-in", () => {
  assert.equal(computePunchHoursWorked({ clockIn: null, clockOut: iso(17) }), null);
});

test("computePunchHoursWorked: null when no clock-out (in progress)", () => {
  assert.equal(computePunchHoursWorked({ clockIn: iso(9), clockOut: null }), null);
});

test("computePunchHoursWorked: null when clock-out is not after clock-in", () => {
  assert.equal(computePunchHoursWorked({ clockIn: iso(17), clockOut: iso(9) }), null);
  assert.equal(computePunchHoursWorked({ clockIn: iso(9), clockOut: iso(9) }), null);
});

// --- computeAttendanceTotals ----------------------------------------------

const punch = (workDate: string, clockIn: string | null, clockOut: string | null) =>
  ({ workDate, clockIn, clockOut } as unknown as PunchLog);

test("computeAttendanceTotals: sums wall-clock hours and counts distinct days", () => {
  const punches = [
    punch("2025-01-15", iso(9), iso(17)), // 8h
    punch("2025-01-16", iso(9), iso(13)), // 4h
  ];
  const r = computeAttendanceTotals(punches, new Date(Date.UTC(2025, 0, 17)));
  assert.equal(r.totalHours, 12);
  assert.equal(r.daysWorked, 2);
});

test("computeAttendanceTotals: two punches on one day count as a single day", () => {
  const punches = [
    punch("2025-01-15", iso(9), iso(12)), // 3h
    punch("2025-01-15", iso(13), iso(17)), // 4h
  ];
  const r = computeAttendanceTotals(punches, new Date(Date.UTC(2025, 0, 17)));
  assert.equal(r.totalHours, 7);
  assert.equal(r.daysWorked, 1);
});

test("computeAttendanceTotals: in-progress punch uses the supplied 'now'", () => {
  const now = new Date(Date.UTC(2025, 0, 15, 15, 0, 0)); // 3pm
  const r = computeAttendanceTotals([punch("2025-01-15", iso(9), null)], now);
  assert.equal(r.totalHours, 6); // 9am → 3pm
  assert.equal(r.daysWorked, 1);
});

test("computeAttendanceTotals: skips punches with no clock-in", () => {
  const r = computeAttendanceTotals(
    [punch("2025-01-15", null, iso(17))],
    new Date(Date.UTC(2025, 0, 17)),
  );
  assert.equal(r.totalHours, 0);
  // A punch with no clock-in is skipped entirely, so it does not count as a day.
  assert.equal(r.daysWorked, 0);
});

test("computeAttendanceTotals: empty input is zeroed", () => {
  const r = computeAttendanceTotals([], new Date());
  assert.equal(r.totalHours, 0);
  assert.equal(r.daysWorked, 0);
});

// --- buildPtoPolicyFromRules ----------------------------------------------

test("buildPtoPolicyFromRules: empty rules fall back to PTO defaults", () => {
  const p = buildPtoPolicyFromRules("pid", "Default", {});
  assert.equal(p.accrualType, DEFAULT_PTO_RULES.accrualType);
  assert.equal(p.accrualHoursPerYear, DEFAULT_PTO_RULES.accrualHoursPerYear);
  assert.equal(p.sickYearlyCapHours, DEFAULT_PTO_RULES.sickYearlyCapHours);
  assert.equal(p.personalHoursPerYear, DEFAULT_PTO_RULES.personalHoursPerYear);
  assert.equal(p.id, "pid");
  assert.equal(p.name, "Default");
  assert.equal(p.isActive, true);
});

test("buildPtoPolicyFromRules: supplied rules override defaults", () => {
  const p = buildPtoPolicyFromRules("pid", "Generous", {
    accrualType: "per_hours_worked",
    accrualHoursPerYear: 200,
    carryoverCapHours: 40,
    vacationAccrualPerHoursWorked: 25,
    waitingPeriodDays: 90,
  });
  assert.equal(p.accrualType, "per_hours_worked");
  assert.equal(p.accrualHoursPerYear, 200);
  assert.equal(p.carryoverCapHours, 40);
  assert.equal(p.vacationAccrualPerHoursWorked, 25);
  assert.equal(p.waitingPeriodDays, 90);
  // Unspecified keys still come from defaults.
  assert.equal(p.personalHoursPerYear, DEFAULT_PTO_RULES.personalHoursPerYear);
});

test("buildPtoPolicyFromRules: null cap/waiting values normalize to safe defaults", () => {
  const p = buildPtoPolicyFromRules("pid", "X", {
    yearlyCapHours: null,
    carryoverCapHours: null,
    waitingPeriodDays: null,
    expirationDate: "",
  });
  assert.equal(p.yearlyCapHours, null);
  assert.equal(p.carryoverCapHours, 0);
  assert.equal(p.waitingPeriodDays, 0);
  assert.equal(p.expirationDate, null);
});

// --- getDefaultRulesForType ------------------------------------------------

test("getDefaultRulesForType: returns the right default block per type", () => {
  assert.deepEqual(getDefaultRulesForType("attendance"), { ...DEFAULT_ATTENDANCE_RULES });
  assert.deepEqual(getDefaultRulesForType("pto"), { ...DEFAULT_PTO_RULES });
  assert.deepEqual(getDefaultRulesForType("payroll"), { ...DEFAULT_PAYROLL_RULES });
});

test("getDefaultRulesForType: unknown type returns an empty object", () => {
  assert.deepEqual(getDefaultRulesForType("nope"), {});
});

test("getDefaultRulesForType: returns a fresh copy (not the shared constant)", () => {
  const a = getDefaultRulesForType("attendance");
  (a as any).otThresholdDaily = 99;
  assert.equal(DEFAULT_ATTENDANCE_RULES.otThresholdDaily, 8, "must not mutate the shared default");
});

// --- overnight & DST / real-elapsed-time correctness ----------------------

test("computePunchHoursWorked: overnight shift crossing midnight", () => {
  // Clock in 22:00, clock out 06:00 the next day → 8 real hours.
  const h = computePunchHoursWorked({
    clockIn: "2025-01-15T22:00:00Z",
    clockOut: "2025-01-16T06:00:00Z",
  });
  assert.equal(h, 8);
});

test("computePunchHoursWorked: overnight shift minus a 30m break", () => {
  const h = computePunchHoursWorked({
    clockIn: "2025-01-15T23:00:00Z",
    clockOut: "2025-01-16T07:30:00Z",
    breakMinutes: 30,
  });
  assert.equal(h, 8);
});

test("computePunchHoursWorked: DST fall-back counts REAL elapsed time, not wall-clock", () => {
  // Fall-back night: 01:30 EDT (-04:00) and 01:30 EST (-05:00) are the SAME
  // wall-clock reading one real hour apart. The engine uses absolute timestamps
  // so it must report 1 hour, never 0. (Deterministic regardless of system TZ.)
  const h = computePunchHoursWorked({
    clockIn: "2025-11-02T01:30:00-04:00",
    clockOut: "2025-11-02T01:30:00-05:00",
  });
  assert.equal(h, 1);
});

test("computePunchHoursWorked: DST spring-forward counts REAL elapsed time", () => {
  // Spring-forward: 01:30 EST (-05:00) → 03:30 EDT (-04:00) is a 1-hour gap in
  // wall-clock terms but a real elapsed time of exactly 1 hour.
  const h = computePunchHoursWorked({
    clockIn: "2025-03-09T01:30:00-05:00",
    clockOut: "2025-03-09T03:30:00-04:00",
  });
  assert.equal(h, 1);
});
