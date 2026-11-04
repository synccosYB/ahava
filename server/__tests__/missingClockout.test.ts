/**
 * Unit coverage for the "forgot to punch out past the max shift" rule:
 *   - an OPEN punch over the max-shift limit accrues NO hours (it is a missing
 *     punch, not a runaway clock-in→now total, and not a "13h worked" shift);
 *   - a punch explicitly marked `missing_clockout` accrues no verified hours
 *     regardless of any placeholder clock-out stored to free the open slot.
 *
 * Run with: `npx tsx server/__tests__/missingClockout.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePunchHoursWorked,
  openPunchExceedsMaxShift,
  MISSING_CLOCKOUT_STATUS,
} from "../punchHours";
import { computeAttendanceTotals } from "../timesheetService";

const MAX = 13;
const NOW = new Date("2026-11-04T20:00:00Z");

test("openPunchExceedsMaxShift: open punch past the limit is flagged", () => {
  const clockIn = new Date(NOW.getTime() - 14 * 3600 * 1000); // 14h open
  assert.equal(openPunchExceedsMaxShift({ clockIn, clockOut: null }, NOW, MAX), true);
});

test("openPunchExceedsMaxShift: open punch within the limit is not flagged", () => {
  const clockIn = new Date(NOW.getTime() - 10 * 3600 * 1000); // 10h open
  assert.equal(openPunchExceedsMaxShift({ clockIn, clockOut: null }, NOW, MAX), false);
});

test("openPunchExceedsMaxShift: a closed punch is never flagged (it has a clock-out)", () => {
  const clockIn = new Date(NOW.getTime() - 40 * 3600 * 1000);
  const clockOut = new Date(NOW.getTime() - 20 * 3600 * 1000);
  assert.equal(openPunchExceedsMaxShift({ clockIn, clockOut }, NOW, MAX), false);
});

test("computePunchHoursWorked: a missing_clockout punch yields null even with a placeholder clock-out", () => {
  const clockIn = new Date("2026-11-02T14:00:00Z");
  const placeholder = new Date(clockIn.getTime() + MAX * 3600 * 1000);
  const h = computePunchHoursWorked({
    clockIn,
    clockOut: placeholder,
    roundedClockIn: clockIn,
    roundedClockOut: placeholder,
    status: MISSING_CLOCKOUT_STATUS,
  });
  assert.equal(h, null);
});

test("computePunchHoursWorked: a normal closed punch still computes hours", () => {
  const clockIn = new Date("2026-11-02T14:00:00Z");
  const clockOut = new Date("2026-11-02T22:00:00Z"); // 8h
  const h = computePunchHoursWorked({ clockIn, clockOut, roundedClockIn: clockIn, roundedClockOut: clockOut });
  assert.equal(h, 8);
});

test("computeAttendanceTotals: an open punch past the max shift contributes 0 hours (Debby's case)", () => {
  // Clocked in ~52h ago, never clocked out.
  const clockIn = new Date(NOW.getTime() - 52 * 3600 * 1000);
  const punches = [
    { id: "p1", employeeId: "e1", workDate: "2026-11-02", clockIn, clockOut: null, roundedClockIn: clockIn, roundedClockOut: null, hoursWorked: null, status: "in-progress", breakMinutes: 0 },
  ] as any[];
  const { totalHours } = computeAttendanceTotals(punches, NOW, MAX);
  assert.equal(totalHours, 0, "no runaway 52h — unverified open shift counts as 0");
});

test("computeAttendanceTotals: a marked missing_clockout punch contributes 0 hours", () => {
  const clockIn = new Date("2026-11-02T14:00:00Z");
  const placeholder = new Date(clockIn.getTime() + MAX * 3600 * 1000);
  const punches = [
    { id: "p1", employeeId: "e1", workDate: "2026-11-02", clockIn, clockOut: placeholder, roundedClockIn: clockIn, roundedClockOut: placeholder, hoursWorked: 0, status: MISSING_CLOCKOUT_STATUS, breakMinutes: 0 },
  ] as any[];
  const { totalHours } = computeAttendanceTotals(punches, NOW, MAX);
  assert.equal(totalHours, 0);
});

test("computeAttendanceTotals: a normal open shift within the limit still accrues live hours", () => {
  const clockIn = new Date(NOW.getTime() - 5 * 3600 * 1000); // 5h, still working
  const punches = [
    { id: "p1", employeeId: "e1", workDate: "2026-11-04", clockIn, clockOut: null, roundedClockIn: clockIn, roundedClockOut: null, hoursWorked: null, status: "in-progress", breakMinutes: 0 },
  ] as any[];
  const { totalHours } = computeAttendanceTotals(punches, NOW, MAX);
  assert.ok(Math.abs(totalHours - 5) < 0.001, `~5h live, got ${totalHours}`);
});
