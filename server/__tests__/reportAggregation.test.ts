/**
 * Verifies the SQL-side report aggregation (getAttendanceAggregatesByDateRange
 * + getTimeOffDaysOffByDateRange) produces totals identical to the previous
 * in-memory approach (computeAttendanceTotals + the report's daysOff loop) on a
 * fixed dataset. This is the regression guard for "Rewrite report generation to
 * scale": numbers must not move when aggregation moves into the database.
 *
 * Run with: `tsx server/__tests__/reportAggregation.test.ts`
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";

const { db } = await import("../db.js");
const schema = await import("../../shared/schema.js");
const { storage } = await import("../storage.js");
const { computeAttendanceTotals } = await import("../timesheetService.js");
const { eq, inArray } = await import("drizzle-orm");

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const startDate = "2026-01-05";
const endDate = "2026-01-11";

async function makeEmployee(suffix: string) {
  const id = `rpt-${suffix}-${stamp}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Rpt",
    lastName: suffix,
    role: "employee",
    status: "active",
  });
  return id;
}

function ts(date: string, time: string) {
  // Naive timestamp (no tz) to match how clock punches are stored.
  return new Date(`${date}T${time}`);
}

const empA = await makeEmployee("a");
const empB = await makeEmployee("b");
const empC = await makeEmployee("c"); // no punches, only time off

const createdUserIds = [empA, empB, empC];

// Old-style daysOff loop (verbatim from the previous report route).
function oldDaysOff(requests: Array<{ startDate: string; endDate: string; status: string }>): number {
  let daysOff = 0;
  for (const r of requests) {
    if (r.status !== "approved" && r.status !== "partially_approved") continue;
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    daysOff += Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }
  return daysOff;
}

try {
  // --- Attendance fixtures ---
  // empA: two closed days + one zero-length punch (counts as a day worked, 0 hrs)
  await storage.createPunchLog({ employeeId: empA, workDate: "2026-01-05", clockIn: ts("2026-01-05", "09:00:00"), clockOut: ts("2026-01-05", "17:30:00"), status: "present" });
  await storage.createPunchLog({ employeeId: empA, workDate: "2026-01-06", clockIn: ts("2026-01-06", "08:15:00"), clockOut: ts("2026-01-06", "16:45:00"), status: "present" });
  await storage.createPunchLog({ employeeId: empA, workDate: "2026-01-07", clockIn: ts("2026-01-07", "10:00:00"), clockOut: ts("2026-01-07", "10:00:00"), status: "present" });
  // empB: split day (two punches same date) + a long OT day
  await storage.createPunchLog({ employeeId: empB, workDate: "2026-01-05", clockIn: ts("2026-01-05", "09:00:00"), clockOut: ts("2026-01-05", "12:00:00"), status: "present" });
  await storage.createPunchLog({ employeeId: empB, workDate: "2026-01-05", clockIn: ts("2026-01-05", "13:00:00"), clockOut: ts("2026-01-05", "17:07:00"), status: "present" });
  await storage.createPunchLog({ employeeId: empB, workDate: "2026-01-08", clockIn: ts("2026-01-08", "07:00:00"), clockOut: ts("2026-01-08", "19:30:00"), status: "present" });
  // A punch OUTSIDE the range must be ignored by both paths.
  await storage.createPunchLog({ employeeId: empB, workDate: "2026-02-01", clockIn: ts("2026-02-01", "09:00:00"), clockOut: ts("2026-02-01", "17:00:00"), status: "present" });

  // --- Time off fixtures ---
  await db.insert(schema.timeOffRequests).values([
    { userId: empA, type: "vacation", startDate: "2026-01-09", endDate: "2026-01-10", status: "approved", hoursRequested: 16 },
    { userId: empC, type: "sick", startDate: "2026-01-06", endDate: "2026-01-06", status: "approved", hoursRequested: 8 },
    { userId: empC, type: "vacation", startDate: "2026-01-07", endDate: "2026-01-09", status: "denied", hoursRequested: 24 },
    // Overlaps the start of the range but begins before it — full span counts.
    { userId: empB, type: "personal", startDate: "2026-01-03", endDate: "2026-01-05", status: "partially_approved", hoursRequested: 24 },
  ]);

  const now = new Date();

  // --- New (SQL) path ---
  const attAgg = await storage.getAttendanceAggregatesByDateRange(startDate, endDate, createdUserIds, now);
  const daysOffAgg = await storage.getTimeOffDaysOffByDateRange(startDate, endDate, createdUserIds, undefined);

  // --- Old (in-memory) path, computed independently for comparison ---
  const allInRange = await storage.getAttendanceByDateRange(startDate, endDate);
  const allTimeOff = await storage.getAllTimeOffRequests();

  for (const id of createdUserIds) {
    const userPunches = allInRange.filter((p) => p.employeeId === id);
    const oldTotals = computeAttendanceTotals(userPunches, now);
    const newTotals = attAgg.get(id) ?? { totalHours: 0, daysWorked: 0 };

    assert.equal(
      Math.round(newTotals.totalHours * 10) / 10,
      Math.round(oldTotals.totalHours * 10) / 10,
      `totalHours mismatch for ${id}: old=${oldTotals.totalHours} new=${newTotals.totalHours}`,
    );
    assert.equal(newTotals.daysWorked, oldTotals.daysWorked, `daysWorked mismatch for ${id}`);

    const oldOvertime = Math.max(0, oldTotals.totalHours - oldTotals.daysWorked * 8);
    const newOvertime = Math.max(0, newTotals.totalHours - newTotals.daysWorked * 8);
    assert.equal(
      Math.round(newOvertime * 10) / 10,
      Math.round(oldOvertime * 10) / 10,
      `overtime mismatch for ${id}`,
    );

    const userTimeOff = allTimeOff.filter(
      (r) => r.userId === id && r.startDate <= endDate && r.endDate >= startDate,
    );
    const oldOff = oldDaysOff(userTimeOff);
    const newOff = daysOffAgg.get(id) ?? 0;
    assert.equal(newOff, oldOff, `daysOff mismatch for ${id}: old=${oldOff} new=${newOff}`);
  }

  // Spot-check concrete expected values so a silently-wrong-but-consistent
  // change to both paths still fails.
  assert.equal(attAgg.get(empA)!.daysWorked, 3, "empA worked 3 days (incl. the zero-length punch day)");
  assert.equal(Math.round(attAgg.get(empA)!.totalHours * 10) / 10, 17, "empA: 8.5 + 8.5 + 0 = 17h");
  assert.equal(daysOffAgg.get(empA), 2, "empA: 2-day vacation");
  assert.equal(daysOffAgg.get(empC), 1, "empC: 1 approved sick day; denied request excluded");
  assert.equal(daysOffAgg.get(empB), 3, "empB: 3-day partially_approved request (full span)");

  // Status filter: status='denied' intersected with approved set => zero.
  const denied = await storage.getTimeOffDaysOffByDateRange(startDate, endDate, createdUserIds, "denied");
  assert.equal(denied.size, 0, "status=denied must yield no days off (no approved+denied rows)");

  // Status filter: status='approved' keeps only approved (drops partially_approved).
  const approvedOnly = await storage.getTimeOffDaysOffByDateRange(startDate, endDate, createdUserIds, "approved");
  assert.equal(approvedOnly.get(empB), undefined, "empB partially_approved excluded when status=approved");
  assert.equal(approvedOnly.get(empA), 2, "empA approved vacation retained when status=approved");

  // Empty user set short-circuits.
  const empty = await storage.getAttendanceAggregatesByDateRange(startDate, endDate, [], now);
  assert.equal(empty.size, 0, "empty userIds returns empty map");

  console.log("✓ reportAggregation: all assertions passed");
} finally {
  await db.delete(schema.timeOffRequests).where(inArray(schema.timeOffRequests.userId, createdUserIds));
  await db.delete(schema.punchLogs).where(inArray(schema.punchLogs.employeeId, createdUserIds));
  for (const id of createdUserIds) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

process.exit(0);
