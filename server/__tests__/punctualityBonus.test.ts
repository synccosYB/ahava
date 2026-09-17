/**
 * Weekly Punctuality Rate Bonus coverage (Task: punctuality-bonus).
 *
 * Covers, per the confirmed spec:
 *   - the differential formula (regular + OT/DT scaled by their multipliers),
 *   - a perfect week auto-qualifies and pays the differential (incl. OT scaled),
 *   - one late day → forfeited_late, no differential,
 *   - a scheduled-day absence with no PTO → pending_review (no pay until approved),
 *   - a PTO-covered absence → still qualifies,
 *   - manager approve → granted (pays); deny → denied (pays nothing),
 *   - a manager decision is sticky across a later payroll re-run,
 *   - end-to-end: the differential surfaces on the payroll batch's bonusAmount.
 *
 * Standalone node:test, run with tsx (no external runner). Requires DATABASE_URL
 * and a migrated + seeded DB. Run: `npx tsx server/__tests__/punctualityBonus.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "../db";
import { storage } from "../storage";
import { registerRoutes } from "../routes";
import { generateToken } from "../middleware/auth";
import {
  users,
  punchLogs,
  employeeSchedules,
  timeOffRequests,
  policies,
  policyRules,
  policyAssignments,
  policyTypes,
  payrollExports,
  payrollBatchRecords,
  punctualityBonusWeeks,
  attendanceChangeLedger,
  attendanceLedger,
  type EmployeeSchedule,
  type PunchLog,
  type TimeOffRequest,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  computePunctualityDifferential,
  resolvePunctualityBonusConfig,
  evaluatePunctualityWeek,
  upsertPunctualityBonusWeek,
  decidePunctualityBonusWeek,
} from "../services/punctualityBonus";

const REVIEWER_ID = "admin-dev-001";
const EMAIL_PREFIX = "punctuality-test+";

// --- helpers to build the pure-eval fixtures -------------------------------
function sched(dayOfWeek: number, startTime = "09:00"): EmployeeSchedule {
  return {
    id: `s${dayOfWeek}`,
    employeeId: "emp",
    dayOfWeek,
    startTime,
    endTime: "17:00",
    isActive: true,
    scheduleTemplateId: null,
  };
}
function punch(workDate: string, clockInUtc: string | null): PunchLog {
  return {
    id: `p-${workDate}`,
    employeeId: "emp",
    workDate,
    clockIn: clockInUtc ? new Date(clockInUtc) : null,
    clockOut: null,
    roundedClockIn: clockInUtc ? new Date(clockInUtc) : null,
    roundedClockOut: null,
    breakMinutes: 0,
    breakStartedAt: null,
    hoursWorked: 8,
    status: "complete",
    notes: null,
    source: "test",
    kioskDeviceId: null,
    punchLatitude: null,
    punchLongitude: null,
    approved: true,
    createdAt: null,
  } as unknown as PunchLog;
}
// Mon–Fri of the workweek starting Sun 2026-03-01.
const WEEK_START = "2026-03-01";
const MON = "2026-03-02";
const TUE = "2026-03-03";
const WED = "2026-03-04";
const THU = "2026-03-05";
const FRI = "2026-03-06";
const MON_FRI = [sched(1), sched(2), sched(3), sched(4), sched(5)];

const evalArgs = (punches: PunchLog[], approvedTimeOff: TimeOffRequest[] = []) => ({
  weekStartDate: WEEK_START,
  workweekStartDay: 0,
  rangeStart: MON,
  rangeEnd: FRI,
  graceMinutes: 10,
  timezone: "UTC",
  schedules: MON_FRI,
  punches,
  approvedTimeOff,
});

// ---------------------------------------------------------------------------
// 1. Pure formula + config
// ---------------------------------------------------------------------------
test("differential = regular*delta + OT*delta*otMult + DT*delta*dtMult", () => {
  // 38 regular, 2 OT (@1.5x), 4 DT (@2x), delta $2/hr.
  const amount = computePunctualityDifferential(
    { regularHours: 38, overtimeHours: 2, doubleTimeHours: 4 },
    2,
    1.5,
    2,
  );
  assert.equal(amount, 38 * 2 + 2 * 2 * 1.5 + 4 * 2 * 2); // 76 + 6 + 16 = 98
  assert.equal(amount, 98);
});

test("config resolves enabled only with a positive per-hour delta", () => {
  assert.equal(resolvePunctualityBonusConfig(undefined).enabled, false); // default off
  assert.equal(resolvePunctualityBonusConfig({ punctualityBonus: { enabled: true, bonusPerHour: 2 } }).enabled, true);
  assert.equal(resolvePunctualityBonusConfig({ punctualityBonus: { enabled: true, bonusPerHour: 0 } }).enabled, false);
  assert.equal(resolvePunctualityBonusConfig({ punctualityBonus: { enabled: false, bonusPerHour: 5 } }).enabled, false);
});

// ---------------------------------------------------------------------------
// 2. Pure weekly evaluation
// ---------------------------------------------------------------------------
test("perfect week (on-time every scheduled day) → qualified", () => {
  const punches = [
    punch(MON, `${MON}T08:55:00Z`),
    punch(TUE, `${TUE}T09:00:00Z`),
    punch(WED, `${WED}T09:08:00Z`), // within 10-min grace
    punch(THU, `${THU}T08:30:00Z`),
    punch(FRI, `${FRI}T09:10:00Z`), // exactly at grace edge (09:00 + 10)
  ];
  const r = evaluatePunctualityWeek(evalArgs(punches));
  assert.equal(r.autoStatus, "qualified");
  assert.equal(r.scheduledDates.length, 5);
});

test("one late day (past grace) → forfeited_late", () => {
  const punches = [
    punch(MON, `${MON}T09:00:00Z`),
    punch(TUE, `${TUE}T09:11:00Z`), // 11 min late > 10 grace
    punch(WED, `${WED}T09:00:00Z`),
    punch(THU, `${THU}T09:00:00Z`),
    punch(FRI, `${FRI}T09:00:00Z`),
  ];
  const r = evaluatePunctualityWeek(evalArgs(punches));
  assert.equal(r.autoStatus, "forfeited_late");
});

test("absence on a scheduled day with no PTO → pending_review", () => {
  const punches = [
    punch(MON, `${MON}T09:00:00Z`),
    punch(TUE, `${TUE}T09:00:00Z`),
    // WED missing entirely
    punch(THU, `${THU}T09:00:00Z`),
    punch(FRI, `${FRI}T09:00:00Z`),
  ];
  const r = evaluatePunctualityWeek(evalArgs(punches));
  assert.equal(r.autoStatus, "pending_review");
});

test("PTO-covered absence on a scheduled day → still qualifies", () => {
  const punches = [
    punch(MON, `${MON}T09:00:00Z`),
    punch(TUE, `${TUE}T09:00:00Z`),
    // WED missing but covered by approved PTO
    punch(THU, `${THU}T09:00:00Z`),
    punch(FRI, `${FRI}T09:00:00Z`),
  ];
  const pto: TimeOffRequest[] = [{
    status: "approved",
    requestCategory: "time_off",
    startDate: WED,
    endDate: WED,
    approvedEndDate: null,
  } as unknown as TimeOffRequest];
  const r = evaluatePunctualityWeek(evalArgs(punches, pto));
  assert.equal(r.autoStatus, "qualified");
});

test("late takes precedence over an absence", () => {
  const punches = [
    punch(MON, `${MON}T09:30:00Z`), // late
    punch(TUE, `${TUE}T09:00:00Z`),
    // WED missing (absence)
    punch(THU, `${THU}T09:00:00Z`),
    punch(FRI, `${FRI}T09:00:00Z`),
  ];
  const r = evaluatePunctualityWeek(evalArgs(punches));
  assert.equal(r.autoStatus, "forfeited_late");
});

// ---------------------------------------------------------------------------
// 3. DB: upsert + payability + manager decision
// ---------------------------------------------------------------------------
async function purgeUser(id: string) {
  await db.delete(punctualityBonusWeeks).where(eq(punctualityBonusWeeks.employeeId, id));
  await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, id));
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id));
  await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, id));
  await db.delete(users).where(eq(users.id, id));
}

async function makeEmployee(label: string): Promise<string> {
  const reviewer = await storage.getUser(REVIEWER_ID);
  assert.ok(reviewer, "expected seeded admin-dev-001");
  const [u] = await db.insert(users).values({
    email: `${EMAIL_PREFIX}${label}-${Date.now()}@example.invalid`,
    firstName: "Punctual",
    lastName: label,
    role: "employee",
    companyId: reviewer.companyId,
  }).returning();
  return u.id;
}

test("upsert: qualified week pays the differential; forfeited/pending pay nothing", async (t) => {
  const empId = await makeEmployee("upsert");
  t.after(() => purgeUser(empId));

  const qualified = await upsertPunctualityBonusWeek(db, {
    employeeId: empId,
    weekStartDate: WEEK_START,
    autoStatus: "qualified",
    reason: "on-time",
    bonusPerHour: 2,
    hours: { regularHours: 38, overtimeHours: 2, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5,
    doubleTimeMultiplier: 2,
  });
  assert.equal(qualified.status, "qualified");
  assert.equal(qualified.bonusAmount, 38 * 2 + 2 * 2 * 1.5); // 82

  const late = await upsertPunctualityBonusWeek(db, {
    employeeId: empId,
    weekStartDate: "2026-03-08",
    autoStatus: "forfeited_late",
    reason: "late",
    bonusPerHour: 2,
    hours: { regularHours: 40, overtimeHours: 0, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5,
    doubleTimeMultiplier: 2,
  });
  assert.equal(late.status, "forfeited_late");
  assert.equal(late.bonusAmount, 0);

  const pending = await upsertPunctualityBonusWeek(db, {
    employeeId: empId,
    weekStartDate: "2026-03-15",
    autoStatus: "pending_review",
    reason: "absent",
    bonusPerHour: 2,
    hours: { regularHours: 32, overtimeHours: 0, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5,
    doubleTimeMultiplier: 2,
  });
  assert.equal(pending.status, "pending_review");
  assert.equal(pending.bonusAmount, 0);
});

test("manager approve → granted pays; deny → denied pays nothing; decision is sticky", async (t) => {
  const empId = await makeEmployee("decide");
  t.after(() => purgeUser(empId));

  // Two pending weeks.
  const w1 = await upsertPunctualityBonusWeek(db, {
    employeeId: empId, weekStartDate: WEEK_START, autoStatus: "pending_review", reason: "absent",
    bonusPerHour: 2, hours: { regularHours: 40, overtimeHours: 0, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
  });
  const w2 = await upsertPunctualityBonusWeek(db, {
    employeeId: empId, weekStartDate: "2026-03-08", autoStatus: "pending_review", reason: "absent",
    bonusPerHour: 2, hours: { regularHours: 40, overtimeHours: 0, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
  });

  const granted = await decidePunctualityBonusWeek(w1.id, "approve", REVIEWER_ID, "looks fine");
  assert.ok(granted);
  assert.equal(granted!.status, "granted");
  assert.equal(granted!.bonusAmount, 80); // 40 * 2
  assert.equal(granted!.decidedBy, REVIEWER_ID);
  assert.ok(granted!.decidedAt);

  const denied = await decidePunctualityBonusWeek(w2.id, "deny", REVIEWER_ID);
  assert.ok(denied);
  assert.equal(denied!.status, "denied");
  assert.equal(denied!.bonusAmount, 0);

  // A pending decision on an already-decided week is refused.
  const again = await decidePunctualityBonusWeek(w1.id, "deny", REVIEWER_ID);
  assert.equal(again, null);

  // A later payroll re-run must NOT revert the manager's decision, but should
  // refresh the frozen hours and recompute the amount from them.
  const reRun = await upsertPunctualityBonusWeek(db, {
    employeeId: empId, weekStartDate: WEEK_START, autoStatus: "forfeited_late", reason: "late arrived after decision",
    bonusPerHour: 2, hours: { regularHours: 50, overtimeHours: 0, doubleTimeHours: 0 },
    overtimeMultiplier: 1.5, doubleTimeMultiplier: 2,
  });
  assert.equal(reRun.status, "granted"); // sticky
  assert.equal(reRun.bonusAmount, 100); // 50 * 2, refreshed from new hours
});

// ---------------------------------------------------------------------------
// 4. End-to-end: differential surfaces on the payroll batch's bonusAmount
// ---------------------------------------------------------------------------
async function purgeE2E(empId: string, exportIds: string[], policyId: string | null) {
  if (exportIds.length) {
    await db.delete(payrollBatchRecords).where(inArray(payrollBatchRecords.payrollExportId, exportIds));
    await db.delete(payrollExports).where(inArray(payrollExports.id, exportIds));
  }
  await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.employeeId, empId));
  await db.delete(punctualityBonusWeeks).where(eq(punctualityBonusWeeks.employeeId, empId));
  await db.delete(attendanceChangeLedger).where(eq(attendanceChangeLedger.employeeId, empId));
  await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, empId));
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, empId));
  await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, empId));
  if (policyId) {
    await db.delete(policyAssignments).where(eq(policyAssignments.policyId, policyId));
    await db.delete(policyRules).where(eq(policyRules.policyId, policyId));
    await db.delete(policies).where(eq(policies.id, policyId));
  }
  await db.delete(users).where(eq(users.id, empId));
}

test("e2e: a perfect week (with OT) pays the punctuality differential on the batch", async (t) => {
  const reviewer = await storage.getUser(REVIEWER_ID);
  assert.ok(reviewer);

  const empId = await makeEmployee("e2e");
  const exportIds: string[] = [];
  let policyId: string | null = null;
  t.after(() => purgeE2E(empId, exportIds, policyId));

  // Mon–Fri 09:00 schedule.
  for (const d of [1, 2, 3, 4, 5]) {
    await db.insert(employeeSchedules).values({
      employeeId: empId, dayOfWeek: d, startTime: "09:00", endTime: "17:00", isActive: true,
    });
  }

  // Employee-level payroll policy with the punctuality bonus enabled ($2/hr).
  const [payrollType] = await db.select().from(policyTypes).where(eq(policyTypes.key, "payroll"));
  assert.ok(payrollType, "expected seeded payroll policy type");
  const [policy] = await db.insert(policies).values({
    companyId: reviewer.companyId,
    policyTypeId: payrollType.id,
    name: `Punctuality E2E ${Date.now()}`,
    status: "active",
  }).returning();
  policyId = policy.id;
  await db.insert(policyRules).values({
    policyId: policy.id,
    rules: { punctualityBonus: { enabled: true, bonusPerHour: 2, label: "Weekly Punctuality Bonus" } },
  });
  await db.insert(policyAssignments).values({ policyId: policy.id, userId: empId });

  // Punches Mon–Fri, all clocked in early (06:00Z ≈ 01:00 EST — on-time), the
  // last day 10h so it yields 2h daily overtime.
  const dates = [MON, TUE, WED, THU, FRI];
  const hours = [8, 8, 8, 8, 10];
  for (let i = 0; i < dates.length; i++) {
    await db.insert(punchLogs).values({
      employeeId: empId,
      workDate: dates[i],
      clockIn: new Date(`${dates[i]}T06:00:00Z`),
      clockOut: new Date(`${dates[i]}T${i === 4 ? "16" : "14"}:00:00Z`),
      roundedClockIn: new Date(`${dates[i]}T06:00:00Z`),
      hoursWorked: hours[i],
      status: "complete",
      source: "test",
      approved: true,
    });
  }

  const app = express();
  app.use(express.json());
  const httpServer = http.createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));
  const { port } = httpServer.address() as AddressInfo;
  const token = generateToken({ id: reviewer.id, email: reviewer.email, role: reviewer.role, companyId: reviewer.companyId });

  const res = await fetch(`http://127.0.0.1:${port}/api/payroll/exports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: MON, endDate: FRI }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `export create failed: ${JSON.stringify(body)}`);
  exportIds.push(body.id);

  // The week qualified: reg 40 + OT 2. Differential = 40*2 + 2*2*1.5 = 86.
  const rows = await db.select().from(payrollBatchRecords)
    .where(eq(payrollBatchRecords.payrollExportId, body.id));
  const empRows = rows.filter((r) => r.employeeId === empId && r.recordType === "attendance");
  const totalReg = empRows.reduce((s, r) => s + (r.regularHours || 0), 0);
  const totalOt = empRows.reduce((s, r) => s + (r.overtimeHours || 0), 0);
  const totalBonus = empRows.reduce((s, r) => s + (r.bonusAmount || 0), 0);
  assert.equal(Math.round(totalReg), 40);
  assert.equal(Math.round(totalOt), 2);
  assert.equal(Math.round(totalBonus * 100) / 100, 86);

  const [week] = await db.select().from(punctualityBonusWeeks)
    .where(eq(punctualityBonusWeeks.employeeId, empId));
  assert.ok(week, "expected a punctuality_bonus_weeks row");
  assert.equal(week.status, "qualified");
  assert.equal(Math.round(week.bonusAmount * 100) / 100, 86);
});
