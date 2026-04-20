import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEarlyArrivalBonuses,
  evaluateDayOfWeekBonuses,
  type EarlyArrivalBonusRule,
  type DayOfWeekBonusRule,
} from "../policyEnforcement";

const earlyRule = (
  overrides: Partial<EarlyArrivalBonusRule> = {},
): EarlyArrivalBonusRule => ({
  id: "ea1",
  cutoffTime: "07:00",
  bonusAmountPerHour: 2,
  minHoursThreshold: 4,
  ...overrides,
});

const dowRule = (
  overrides: Partial<DayOfWeekBonusRule> = {},
): DayOfWeekBonusRule => ({
  id: "dow1",
  dayOfWeek: 3,
  minHoursThreshold: 8,
  bonusType: "money",
  bonusAmount: 25,
  ...overrides,
});

const WED_DATE = "2025-01-15";
const SAT_DATE = "2025-01-18";

const localClockIn = (h: number, m: number) => new Date(2025, 0, 15, h, m, 0, 0);

test("evaluateEarlyArrivalBonuses: pays bonus when clock-in is before cutoff and threshold met", () => {
  const rules = { earlyArrivalBonuses: [earlyRule()] };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 30), 8, rules);
  assert.equal(result.bonusAmount, 16);
  assert.equal(result.descriptions.length, 1);
});

test("evaluateEarlyArrivalBonuses: no bonus when clock-in is at/after cutoff", () => {
  const rules = { earlyArrivalBonuses: [earlyRule()] };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(7, 0), 8, rules);
  assert.equal(result.bonusAmount, 0);
  assert.equal(result.descriptions.length, 0);
});

test("evaluateEarlyArrivalBonuses: no bonus when hours worked below threshold", () => {
  const rules = { earlyArrivalBonuses: [earlyRule({ minHoursThreshold: 6 })] };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 5, rules);
  assert.equal(result.bonusAmount, 0);
});

test("evaluateEarlyArrivalBonuses: respects daysOfWeek filter (excluded)", () => {
  const rules = {
    earlyArrivalBonuses: [earlyRule({ daysOfWeek: [1, 2] })],
  };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, rules);
  assert.equal(result.bonusAmount, 0);
});

test("evaluateEarlyArrivalBonuses: respects daysOfWeek filter (included)", () => {
  const rules = {
    earlyArrivalBonuses: [earlyRule({ daysOfWeek: [3] })],
  };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, rules);
  assert.equal(result.bonusAmount, 16);
});

test("evaluateEarlyArrivalBonuses: returns zero when clockIn is null", () => {
  const rules = { earlyArrivalBonuses: [earlyRule()] };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, null, 8, rules);
  assert.equal(result.bonusAmount, 0);
  assert.equal(result.descriptions.length, 0);
});

test("evaluateEarlyArrivalBonuses: returns zero when no rules configured", () => {
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, {});
  assert.equal(result.bonusAmount, 0);
});

test("evaluateEarlyArrivalBonuses: sums multiple matching rules", () => {
  const rules = {
    earlyArrivalBonuses: [
      earlyRule({ id: "a", cutoffTime: "07:00", bonusAmountPerHour: 2 }),
      earlyRule({ id: "b", cutoffTime: "08:00", bonusAmountPerHour: 1 }),
    ],
  };
  const result = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, rules);
  assert.equal(result.bonusAmount, 24);
  assert.equal(result.descriptions.length, 2);
});

test("evaluateDayOfWeekBonuses: money bonus when day matches and threshold met", () => {
  const rules = { dayOfWeekBonuses: [dowRule()] };
  const result = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  assert.equal(result.bonusAmount, 25);
  assert.equal(result.bonusHours, 0);
  assert.equal(result.descriptions.length, 1);
});

test("evaluateDayOfWeekBonuses: hours bonus when bonusType is hours", () => {
  const rules = {
    dayOfWeekBonuses: [dowRule({ bonusType: "hours", bonusAmount: 2 })],
  };
  const result = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  assert.equal(result.bonusHours, 2);
  assert.equal(result.bonusAmount, 0);
});

test("evaluateDayOfWeekBonuses: no bonus when day does not match", () => {
  const rules = { dayOfWeekBonuses: [dowRule({ dayOfWeek: 6 })] };
  const result = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  assert.equal(result.bonusAmount, 0);
  assert.equal(result.bonusHours, 0);
});

test("evaluateDayOfWeekBonuses: no bonus when below threshold", () => {
  const rules = { dayOfWeekBonuses: [dowRule({ minHoursThreshold: 10 })] };
  const result = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  assert.equal(result.bonusAmount, 0);
});

test("evaluateDayOfWeekBonuses: matches Saturday correctly", () => {
  const rules = { dayOfWeekBonuses: [dowRule({ dayOfWeek: 6, bonusAmount: 50 })] };
  const result = evaluateDayOfWeekBonuses(SAT_DATE, 8, rules);
  assert.equal(result.bonusAmount, 50);
});

test("evaluateDayOfWeekBonuses: returns zero when no rules configured", () => {
  const result = evaluateDayOfWeekBonuses(WED_DATE, 8, {});
  assert.equal(result.bonusAmount, 0);
  assert.equal(result.bonusHours, 0);
});

test("combined additive: payroll batch sums early-arrival and day-of-week bonuses", () => {
  const rules = {
    earlyArrivalBonuses: [earlyRule()],
    dayOfWeekBonuses: [dowRule()],
  };
  const early = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, rules);
  const dow = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  const combined = Math.round((early.bonusAmount + dow.bonusAmount) * 100) / 100;
  assert.equal(early.bonusAmount, 16);
  assert.equal(dow.bonusAmount, 25);
  assert.equal(combined, 41);
  const descriptions = [...dow.descriptions, ...early.descriptions];
  assert.equal(descriptions.length, 2);
});

test("combined additive: hours bonus stays separate from money bonus", () => {
  const rules = {
    earlyArrivalBonuses: [earlyRule()],
    dayOfWeekBonuses: [dowRule({ bonusType: "hours", bonusAmount: 1.5 })],
  };
  const early = evaluateEarlyArrivalBonuses(WED_DATE, localClockIn(6, 0), 8, rules);
  const dow = evaluateDayOfWeekBonuses(WED_DATE, 8, rules);
  const combinedMoney = Math.round((early.bonusAmount + dow.bonusAmount) * 100) / 100;
  assert.equal(combinedMoney, 16);
  assert.equal(dow.bonusHours, 1.5);
});
