import type { PunchLog, TimeOffRequest, User } from "@shared/schema";
import { storage } from "./storage";
import { DEFAULT_ATTENDANCE_RULES, getEffectivePolicy } from "./policyEngine";
import { resolvePayCalcPolicy } from "./payrollEngine";
import { getLedgerForEmployee, summarizeLedger, type LedgerDay } from "./attendanceLedger";
import { MISSING_CLOCKOUT_STATUS, MISSING_CLOCKIN_STATUS, openPunchExceedsMaxShift } from "./punchHours";

export type TimesheetStatus =
  | "complete"
  | "in_progress"
  | "missing_punch"
  | "overtime"
  | "pto"
  // Confirmation-only (fixed-salary / daily-rate) employees: the clock is a
  // daily "present" marker, hours are not counted, and a day with any punch is
  // never a missing/open punch. Rendered as "Attendance captured".
  | "confirmation"
  | "none";

export interface TimesheetEntry {
  date: string;
  dayOfWeek: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  totalHours: number | null;
  overtimeHours: number;
  status: TimesheetStatus;
  ptoType: string | null;
  // Source attribution: the kiosk the punch came from, when any of the
  // day's punches were captured at a registered kiosk. `null` means a
  // web/manager-entered punch (or no punches at all on that day).
  sources: Array<{ kioskDeviceId: string | null; kioskName: string | null; kiosk: { id: string; name: string } | null }>;
}

export interface TimesheetTotals {
  totalHours: number;
  overtimeHours: number;
  daysWorked: number;
}

export interface TimesheetResult {
  otThresholdDaily: number;
  entries: TimesheetEntry[];
  totals: TimesheetTotals;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Single per-punch worked-hours input, shared by the timesheet and the time
 * report. This is the SAME canonical, break-deducted value payroll consumes:
 * the persisted `hours_worked` (set at clock-out via the engine and by
 * `computePunchHoursWorked`). Only a still-open punch (no stored value yet)
 * falls back to a live, break-deducted compute mirroring `storage.clockOut` and
 * `storage.getDailyHoursByDateRange`, so no surface can drift on break
 * deductions or rounding.
 */
function punchWorkedHours(
  p: PunchLog,
  now: Date,
  maxShiftHours: number = DEFAULT_ATTENDANCE_RULES.maxShiftHours,
): number {
  // Forgotten punch-out (marked, or still open past the max shift): unverified,
  // contributes no hours until a manager sets the real clock-out.
  if (p.status === MISSING_CLOCKOUT_STATUS) return 0;
  if (p.hoursWorked != null) return p.hoursWorked;
  if (!p.clockIn) return 0;
  if (openPunchExceedsMaxShift(p, now, maxShiftHours)) return 0;
  const start = new Date(p.roundedClockIn ?? p.clockIn).getTime();
  const end = p.clockOut ? new Date(p.roundedClockOut ?? p.clockOut).getTime() : now.getTime();
  if (!(end > start)) return 0;
  const breakMs = (p.breakMinutes || 0) * 60 * 1000;
  return Math.max(0, (end - start - breakMs) / (1000 * 60 * 60));
}

/**
 * Worked hours for a single day's punches (break-deducted, via punchWorkedHours).
 */
function computeDayHours(
  punches: PunchLog[],
  now: Date = new Date(),
  maxShiftHours: number = DEFAULT_ATTENDANCE_RULES.maxShiftHours,
): number {
  let hours = 0;
  for (const p of punches) {
    hours += punchWorkedHours(p, now, maxShiftHours);
  }
  return hours;
}

/**
 * Aggregate-only variant used by the time report. Returns the same totals the
 * /api/reports/generate endpoint would produce for one employee. Sharing this
 * helper (and punchWorkedHours) guarantees the per-employee timesheet totals
 * match the time report AND the payroll batch worked-hours input.
 */
export function computeAttendanceTotals(
  punches: PunchLog[],
  now: Date = new Date(),
  maxShiftHours: number = DEFAULT_ATTENDANCE_RULES.maxShiftHours,
): { totalHours: number; daysWorked: number } {
  const daysWorked = new Set<string>();
  let totalHours = 0;
  for (const p of punches) {
    if (!p.clockIn) continue;
    totalHours += punchWorkedHours(p, now, maxShiftHours);
    daysWorked.add(p.workDate);
  }
  return { totalHours, daysWorked: daysWorked.size };
}

// Re-export the canonical per-punch hours-worked computation so callers can
// treat timesheetService as the single hours-engine entry point.
export { computePunchHoursWorked } from "./punchHours";

/**
 * Build a per-day timesheet for an employee over a date range, plus aggregate
 * totals. Both the per-day overtime and the aggregate overtime are produced by
 * the single authoritative pay engine (`resolvePayCalcPolicy` + `splitDailyHours`),
 * so the timesheet honors the full effective policy — daily OT threshold, the
 * payroll OT/double-time toggles, and the holiday-OT-exclusion rule — and never
 * disagrees with the time report, payroll batch, or reconciliation.
 *
 * The timesheet shows a single "Overtime" column, so per-day overtime here is
 * OT + double-time combined (i.e. all hours over the daily OT threshold, unless
 * the day is an excluded holiday). Aggregate overtime is the per-day overtime
 * summed — NOT the old "totalHours - daysWorked * 8" approximation (which let a
 * long day net against a short day).
 */
export async function buildEmployeeTimesheet(
  employee: User,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Promise<TimesheetResult> {
  const punches = await storage.getAttendanceRecords(employee.id, startDate, endDate);
  const allTimeOff = await storage.getTimeOffRequestsByUser(employee.id);
  const approvedTimeOff = allTimeOff.filter((r) =>
    (r.status === "approved" || r.status === "partially_approved") &&
    r.requestCategory !== "cashout" &&
    r.startDate <= endDate &&
    ((r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate) >= startDate),
  );

  // Hours/OT come from THE attendance ledger — the single, persisted
  // materialization of the pay engine (resolvePayCalcPolicy + splitDailyHours
  // per day, including the daily OT threshold, OT/double-time toggles and the
  // holiday-OT-exclusion rule). The timesheet adds ONLY display fields
  // (clock-in/out, break, kiosk sources) from the raw punches; it derives no
  // attendance/OT math of its own, so it can never disagree with reports,
  // payroll or the dashboards (which read the same ledger).
  const payCalc = await resolvePayCalcPolicy(employee);
  const otThreshold = payCalc.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
  // Confirmation-only (attendance-only) employees: any day with a punch is
  // "Attendance captured" — hours aren't counted and it is NEVER a missing or
  // in-progress punch, whatever shape the underlying punches take (a proper
  // 0-hour confirmation marker, or legacy open clock-ins recorded before the
  // toggle was set).
  const confirmationOnly = await storage.isClockConfirmationOnly(employee.id);
  const attendancePolicy = await getEffectivePolicy(employee.companyId, employee.id, "attendance", employee);
  const maxShiftHours = attendancePolicy?.rules?.maxShiftHours ?? DEFAULT_ATTENDANCE_RULES.maxShiftHours;
  const ledgerDays = await getLedgerForEmployee(employee, startDate, endDate, now);
  const ledgerByDate = new Map<string, LedgerDay>(ledgerDays.map((d) => [d.workDate, d]));

  const punchesByDate = new Map<string, PunchLog[]>();
  for (const p of punches) {
    const arr = punchesByDate.get(p.workDate) || [];
    arr.push(p);
    punchesByDate.set(p.workDate, arr);
  }

  // Resolve kiosk device names once per range so the per-day rows can show
  // the source (e.g., "Lobby Kiosk") without N round trips.
  const kioskIds = new Set<string>();
  for (const p of punches) {
    if (p.kioskDeviceId) kioskIds.add(p.kioskDeviceId);
  }
  const kioskNameById = new Map<string, string>();
  for (const id of Array.from(kioskIds)) {
    const d = await storage.getKioskDevice(id);
    if (d) kioskNameById.set(id, d.name);
  }

  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  const entries: TimesheetEntry[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateStr = cursor.toISOString().split("T")[0];
    const dayOfWeek = DAY_NAMES[cursor.getUTCDay()];
    const datePunches = punchesByDate.get(dateStr) || [];
    const ptoForDay = approvedTimeOff.filter((r) => {
      const effectiveEnd = r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate;
      return r.startDate <= dateStr && effectiveEnd >= dateStr;
    });

    // Per-day source attribution (dedup by kiosk id; null → manual/web).
    const sourcesForDay = (() => {
      if (!datePunches.length) return [] as TimesheetEntry["sources"];
      const seen = new Set<string>();
      const out: TimesheetEntry["sources"] = [];
      for (const p of datePunches) {
        const key = p.kioskDeviceId ?? "__manual__";
        if (seen.has(key)) continue;
        seen.add(key);
        const name = p.kioskDeviceId ? (kioskNameById.get(p.kioskDeviceId) ?? null) : null;
        out.push({
          kioskDeviceId: p.kioskDeviceId ?? null,
          kioskName: name,
          kiosk: p.kioskDeviceId && name ? { id: p.kioskDeviceId, name } : null,
        });
      }
      return out;
    })();

    if (datePunches.length > 0) {
      let firstIn: Date | null = null;
      let lastOut: Date | null = null;
      let breakMin = 0;
      let inProgress = false;
      let missingPunch = false;
      for (const p of datePunches) {
        if (p.clockIn) {
          const t = new Date(p.clockIn);
          if (!firstIn || t < firstIn) firstIn = t;
        }
        // A marked missing-clock-out punch carries only a PLACEHOLDER clock-out
        // (set to free the one-open-punch slot); it is not a real punch-out, so
        // it must never show as the day's clock-out time — the day reads blank.
        if (p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS) {
          const t = new Date(p.clockOut);
          if (!lastOut || t > lastOut) lastOut = t;
        }
        breakMin += p.breakMinutes || 0;
        if (p.status === MISSING_CLOCKOUT_STATUS || openPunchExceedsMaxShift(p, now, maxShiftHours)) {
          // Forgotten punch-out (marked, or open past the max shift): a missing
          // punch, NOT an in-progress shift — it no longer accrues hours.
          missingPunch = true;
        } else if (p.status === MISSING_CLOCKIN_STATUS || (p.clockOut && !p.clockIn)) {
          // Clock-out only (forgot to clock in): a missing punch, not in-progress.
          missingPunch = true;
        } else if (p.status === "in-progress") {
          inProgress = true;
        } else if (p.clockIn && !p.clockOut && !p.hoursWorked) {
          missingPunch = true;
        }
      }

      // At Ahava a lunch/break is taken by clocking OUT and back IN, so the real
      // break for the day is the time spent clocked out BETWEEN punches (the gap
      // from one punch-out to the next punch-in) — not the per-punch breakMinutes
      // field (which stays 0 for ordinary punch pairs). Add that gap time so a
      // normal out-for-lunch / back-in day shows its break length (e.g. 30 min),
      // on top of any explicit within-punch break already summed above.
      const completedForGaps = datePunches
        .filter((p) => p.clockIn && p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS)
        .map((p) => ({
          inMs: new Date(p.clockIn as unknown as string).getTime(),
          outMs: new Date(p.clockOut as unknown as string).getTime(),
        }))
        .sort((a, b) => a.inMs - b.inMs);
      let gapMinutes = 0;
      for (let i = 0; i < completedForGaps.length - 1; i++) {
        const gapMs = completedForGaps[i + 1].inMs - completedForGaps[i].outMs;
        if (gapMs > 0) gapMinutes += gapMs / 60000;
      }
      breakMin += Math.round(gapMinutes);

      // Hours + combined overtime come straight from the ledger row for this
      // day (the materialized engine split). Fall back to the raw worked-hours
      // sum only for a zero/edge day the ledger doesn't persist a row for.
      const ledgerDay = ledgerByDate.get(dateStr);
      const roundedHours = ledgerDay
        ? ledgerDay.totalHours
        : Math.round(computeDayHours(datePunches, now, maxShiftHours) * 100) / 100;
      // The timesheet's one "Overtime" column shows OT + double-time combined;
      // holidayOtExclusion (when set) already zeroed these in the ledger.
      const dayOvertime = ledgerDay
        ? Math.round((ledgerDay.overtimeHours + ledgerDay.doubleTimeHours) * 100) / 100
        : 0;

      let status: TimesheetStatus;
      if (confirmationOnly) status = "confirmation";
      else if (inProgress) status = "in_progress";
      else if (missingPunch) status = "missing_punch";
      else if (ledgerDay?.status === "overtime") status = "overtime";
      else status = "complete";

      const entry: TimesheetEntry = {
        date: dateStr,
        dayOfWeek,
        clockIn: firstIn ? firstIn.toISOString() : null,
        // A confirmation marker is a single daily tap; the placeholder clock-out
        // isn't a real punch-out, so leave the clock-out column blank.
        clockOut: confirmationOnly ? null : (lastOut ? lastOut.toISOString() : null),
        breakMinutes: confirmationOnly ? 0 : breakMin,
        // Hours are not counted for attendance-only employees — show "—".
        totalHours: confirmationOnly ? null : roundedHours,
        overtimeHours: confirmationOnly || inProgress ? 0 : dayOvertime,
        status,
        ptoType: null,
        sources: sourcesForDay,
      };
      entries.push(entry);
    } else if (ptoForDay.length > 0) {
      const primary = ptoForDay[0];
      entries.push({
        date: dateStr,
        dayOfWeek,
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        totalHours: null,
        overtimeHours: 0,
        status: "pto",
        ptoType: primary.type,
        sources: [],
      });
    } else {
      entries.push({
        date: dateStr,
        dayOfWeek,
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        totalHours: null,
        overtimeHours: 0,
        status: "none",
        ptoType: null,
        sources: [],
      });
    }
  }

  // Range totals come straight from the ledger summary (the single source), so
  // the totals row matches the time report and payroll exactly. The ledger is
  // now WEEKLY-AWARE (built via payrollEngine.computeWeeklyHours), so each day's
  // OT+double-time already includes weekly overtime — no separate weekly pass is
  // needed here, and per-day rows + totals stay in lockstep with reports/payroll.
  const ledgerTotals = summarizeLedger(ledgerDays);

  // For an attendance-only employee hours aren't counted, so the ledger's
  // hours-based "days worked" is 0. Count days PRESENT instead (every
  // "Attendance captured" day) so the summary reflects attendance, not hours.
  const daysWorked = confirmationOnly
    ? entries.filter((e) => e.status === "confirmation").length
    : ledgerTotals.daysWorked;

  return {
    otThresholdDaily: otThreshold,
    entries,
    totals: {
      totalHours: Math.round(ledgerTotals.totalHours * 10) / 10,
      overtimeHours: Math.round(ledgerTotals.overtimeCombined * 10) / 10,
      daysWorked,
    },
  };
}
