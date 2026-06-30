/**
 * Golden consistency test for the canonical attendance ledger (Task #464).
 *
 * The ledger is the SINGLE materialization of the pay engine that the timesheet,
 * reports, dashboards and payroll all read. This test seeds a real matrix of
 * punches for one throwaway employee (regular / overtime / double-time / holiday
 * / multi-punch days) and asserts that, for the SAME facts:
 *   - the ledger's per-day regular/OT/DT/total split equals a direct engine
 *     computation (resolvePayCalcPolicy + splitDailyHours) — i.e. the ledger
 *     adds no math of its own; and
 *   - the INDEPENDENT timesheet implementation (buildEmployeeTimesheet) produces
 *     byte-for-byte the same per-day total hours and combined overtime, and the
 *     same range totals.
 *
 * If these diverge, a surface has drifted off the single source of truth.
 *
 * Run with: `tsx server/__tests__/attendanceLedger.test.ts`
 */
import assert from "node:assert/strict";

const { db } = await import("../db.js");
const { users, punchLogs, employeeSchedules, attendanceLedger } = await import("@shared/schema");
const { eq, and } = await import("drizzle-orm");
const { resolvePayCalcPolicy, splitDailyHours, round2 } = await import("../payrollEngine.js");
const { getLedgerForEmployee, summarizeLedger, recomputeLedger, getPersistedHoursRollup } = await import("../attendanceLedger.js");
const { buildEmployeeTimesheet } = await import("../timesheetService.js");

let passed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    throw new Error(`FAILED: ${name}${detail ? ` — ${detail}` : ""}`);
  }
  passed++;
}

// 2025-01-06 is a Monday. Scheduled days are Mon–Fri (1..5); Saturday is a
// non-scheduled "holiday".
const startDate = "2025-01-06";
const endDate = "2025-01-12";
const now = new Date("2025-01-13T12:00:00Z");

// Each entry: workDate -> total worked hours for the day (closed punches, with
// hours_worked persisted so there's no live-time flakiness).
const dayMatrix: Array<{ date: string; hours: number[] }> = [
  { date: "2025-01-06", hours: [8] }, // Mon: exactly the OT threshold
  { date: "2025-01-07", hours: [10] }, // Tue: into overtime
  { date: "2025-01-08", hours: [14] }, // Wed: into double-time
  { date: "2025-01-09", hours: [5, 4] }, // Thu: multi-punch day summing to 9
  { date: "2025-01-11", hours: [10] }, // Sat: non-scheduled => holiday
];

function tsForDate(date: string, offsetHours: number): Date {
  return new Date(`${date}T0${offsetHours}:00:00Z`);
}

async function main() {
  const [user] = await db
    .insert(users)
    .values({
      email: `ledger-test-${Date.now()}@example.invalid`,
      firstName: "Ledger",
      lastName: "Test",
      role: "employee",
    })
    .returning();

  try {
    // Mon–Fri active schedule.
    for (let dow = 1; dow <= 5; dow++) {
      await db.insert(employeeSchedules).values({
        employeeId: user.id,
        dayOfWeek: dow,
        startTime: "09:00",
        endTime: "17:00",
        isActive: true,
      });
    }

    // Seed punches with explicit persisted hours_worked, capturing ids by date
    // so the mutation-hook section can edit/delete specific punches.
    const punchIdsByDate = new Map<string, string[]>();
    for (const day of dayMatrix) {
      let clock = 1;
      for (const h of day.hours) {
        const [row] = await db
          .insert(punchLogs)
          .values({
            employeeId: user.id,
            workDate: day.date,
            clockIn: tsForDate(day.date, clock),
            clockOut: tsForDate(day.date, clock + 1),
            roundedClockIn: tsForDate(day.date, clock),
            roundedClockOut: tsForDate(day.date, clock + 1),
            breakMinutes: 0,
            hoursWorked: h,
            status: "present",
            approved: true,
          })
          .returning();
        const arr = punchIdsByDate.get(day.date) || [];
        arr.push(row.id);
        punchIdsByDate.set(day.date, arr);
      }
    }

    const payCalc = await resolvePayCalcPolicy(user);
    const ledger = await getLedgerForEmployee(user, startDate, endDate, now);
    const ledgerByDate = new Map(ledger.map((d) => [d.workDate, d]));

    const scheduledDays = [1, 2, 3, 4, 5];
    const dayOfWeekUTC = (dateStr: string): number => {
      const p = dateStr.split("-");
      return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    };

    // (1) Ledger split == direct engine split for every seeded day.
    for (const day of dayMatrix) {
      const totalInput = round2(day.hours.reduce((a, b) => a + b, 0));
      const isHoliday = !scheduledDays.includes(dayOfWeekUTC(day.date));
      const expected = splitDailyHours(totalInput, payCalc, { isHoliday });
      const row = ledgerByDate.get(day.date);
      check(`ledger row exists for ${day.date}`, !!row);
      if (!row) continue;
      check(
        `ledger regular matches engine ${day.date}`,
        row.regularHours === expected.regularHours,
        `${row.regularHours} vs ${expected.regularHours}`,
      );
      check(
        `ledger OT matches engine ${day.date}`,
        row.overtimeHours === expected.overtimeHours,
        `${row.overtimeHours} vs ${expected.overtimeHours}`,
      );
      check(
        `ledger DT matches engine ${day.date}`,
        row.doubleTimeHours === expected.doubleTimeHours,
        `${row.doubleTimeHours} vs ${expected.doubleTimeHours}`,
      );
      check(
        `ledger total matches engine ${day.date}`,
        row.totalHours === expected.hoursWorked,
        `${row.totalHours} vs ${expected.hoursWorked}`,
      );
      check(
        `ledger holiday flag correct ${day.date}`,
        row.isHoliday === isHoliday,
      );
      check(
        `ledger total == reg+ot+dt ${day.date}`,
        round2(row.regularHours + row.overtimeHours + row.doubleTimeHours) === row.totalHours,
      );
    }

    // (2) Saturday is detected as a holiday; weekdays are not.
    check("Saturday flagged holiday", ledgerByDate.get("2025-01-11")?.isHoliday === true);
    check("Monday not holiday", ledgerByDate.get("2025-01-06")?.isHoliday === false);

    // (3) Multi-punch day summed correctly (5 + 4 = 9).
    check(
      "multi-punch day total = 9",
      ledgerByDate.get("2025-01-09")?.totalHours === 9,
      `${ledgerByDate.get("2025-01-09")?.totalHours}`,
    );
    check("multi-punch source count = 2", ledgerByDate.get("2025-01-09")?.sourcePunchCount === 2);

    // (4) INDEPENDENT timesheet implementation agrees per-day and in totals.
    const timesheet = await buildEmployeeTimesheet(user, startDate, endDate, now);
    const tsByDate = new Map(timesheet.entries.map((e) => [e.date, e]));
    for (const day of dayMatrix) {
      const row = ledgerByDate.get(day.date)!;
      const tsEntry = tsByDate.get(day.date);
      check(`timesheet entry exists ${day.date}`, !!tsEntry);
      if (!tsEntry) continue;
      check(
        `timesheet total == ledger total ${day.date}`,
        round2(tsEntry.totalHours ?? 0) === row.totalHours,
        `${tsEntry.totalHours} vs ${row.totalHours}`,
      );
      check(
        `timesheet OT (combined) == ledger OT+DT ${day.date}`,
        round2(tsEntry.overtimeHours) === round2(row.overtimeHours + row.doubleTimeHours),
        `${tsEntry.overtimeHours} vs ${round2(row.overtimeHours + row.doubleTimeHours)}`,
      );
    }

    // (5) Range totals agree between ledger summary and timesheet totals.
    const totals = summarizeLedger(ledger);
    check(
      "range total hours agree",
      round2(totals.totalHours) === round2(timesheet.totals.totalHours),
      `${totals.totalHours} vs ${timesheet.totals.totalHours}`,
    );
    check(
      "range overtime agree",
      round2(totals.overtimeCombined) === round2(timesheet.totals.overtimeHours),
      `${totals.overtimeCombined} vs ${timesheet.totals.overtimeHours}`,
    );
    check(
      "range days worked agree",
      totals.daysWorked === timesheet.totals.daysWorked,
      `${totals.daysWorked} vs ${timesheet.totals.daysWorked}`,
    );

    // (6) The diff-upsert read path is idempotent: a second read returns the
    // same rows without throwing and the persisted table matches.
    const second = await getLedgerForEmployee(user, startDate, endDate, now);
    check("idempotent read same row count", second.length === ledger.length);
    const persisted = await db
      .select()
      .from(attendanceLedger)
      .where(eq(attendanceLedger.employeeId, user.id));
    check("persisted rows match computed", persisted.length === ledger.length);

    // (6b) The READ-ONLY rollup (the cheap "sort by hours" path) reads the
    // PERSISTED rows and agrees with the recompute-through ledger totals. weekHours
    // == sum of all days; todayHours == that single day's total (9 for 2025-01-09).
    const rollup = await getPersistedHoursRollup([user.id], startDate, endDate, "2025-01-09");
    const r = rollup.get(user.id);
    check("rollup row exists", !!r);
    check(
      "rollup weekHours == ledger total",
      round2(r!.weekHours) === round2(totals.totalHours),
      `${r!.weekHours} vs ${totals.totalHours}`,
    );
    check(
      "rollup todayHours == that day's ledger total",
      round2(r!.todayHours) === round2(ledgerByDate.get("2025-01-09")!.totalHours),
      `${r!.todayHours} vs ${ledgerByDate.get("2025-01-09")!.totalHours}`,
    );
    // A day with no persisted rows contributes 0 today-hours.
    const rollupEmptyToday = await getPersistedHoursRollup([user.id], startDate, endDate, "2025-01-10");
    check("rollup todayHours 0 for empty day", rollupEmptyToday.get(user.id)?.todayHours === 0);
    // An unknown employee simply has no rollup entry (treated as 0 by callers).
    const rollupUnknown = await getPersistedHoursRollup(["00000000-0000-0000-0000-000000000000"], startDate, endDate, "2025-01-09");
    check("rollup empty for unknown employee", rollupUnknown.size === 0);

    // (7) Recompute hook on a punch EDIT updates the PERSISTED ledger row WITHOUT
    // a fresh read — this is exactly what the punch PATCH route does after a DB
    // write. Drop Tuesday from 10h (8 reg + 2 OT) to 6h (6 reg, 0 OT).
    const tueId = punchIdsByDate.get("2025-01-07")![0];
    await db.update(punchLogs).set({ hoursWorked: 6 }).where(eq(punchLogs.id, tueId));
    await recomputeLedger(user.id, ["2025-01-07"]);
    const [tueRow] = await db
      .select()
      .from(attendanceLedger)
      .where(and(eq(attendanceLedger.employeeId, user.id), eq(attendanceLedger.workDate, "2025-01-07")));
    check("edit hook persisted new total", tueRow?.totalHours === 6, `${tueRow?.totalHours}`);
    check("edit hook persisted zero OT", tueRow?.overtimeHours === 0, `${tueRow?.overtimeHours}`);
    check("edit hook persisted regular = 6", tueRow?.regularHours === 6, `${tueRow?.regularHours}`);

    // (8) Recompute hook on a punch DELETE removes the persisted ledger row for a
    // now-empty day — exactly what the punch DELETE route does after a DB write.
    const monId = punchIdsByDate.get("2025-01-06")![0];
    await db.delete(punchLogs).where(eq(punchLogs.id, monId));
    await recomputeLedger(user.id, ["2025-01-06"]);
    const monRows = await db
      .select()
      .from(attendanceLedger)
      .where(and(eq(attendanceLedger.employeeId, user.id), eq(attendanceLedger.workDate, "2025-01-06")));
    check("delete hook removed persisted row", monRows.length === 0);

    // (9) After the mutations, a ledger-backed timesheet read reflects them — the
    // timesheet endpoint derives ALL hours/OT from the ledger, so it can't drift.
    const tsAfter = await buildEmployeeTimesheet(user, startDate, endDate, now);
    const tsAfterByDate = new Map(tsAfter.entries.map((e) => [e.date, e]));
    check("timesheet reflects edited Tuesday total", tsAfterByDate.get("2025-01-07")?.totalHours === 6);
    check("timesheet reflects edited Tuesday OT", tsAfterByDate.get("2025-01-07")?.overtimeHours === 0);
    check("timesheet reflects deleted Monday", tsAfterByDate.get("2025-01-06")?.status === "none");

    console.log(`\u2713 attendanceLedger: all ${passed} assertions passed`);
  } finally {
    await db.delete(attendanceLedger).where(eq(attendanceLedger.employeeId, user.id));
    await db.delete(punchLogs).where(eq(punchLogs.employeeId, user.id));
    await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
}

await main();
