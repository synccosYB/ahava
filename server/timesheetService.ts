import type { PunchLog, TimeOffRequest, User } from "@shared/schema";
import { storage } from "./storage";
import { DEFAULT_ATTENDANCE_RULES } from "./policyEngine";
import { resolvePayCalcPolicy } from "./payrollEngine";
import { getLedgerForEmployee, summarizeLedger, type LedgerDay } from "./attendanceLedger";

export type TimesheetStatus =
  | "complete"
  | "in_progress"
  | "missing_punch"
  | "overtime"
  | "pto"
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
function punchWorkedHours(p: PunchLog, now: Date): number {
  if (p.hoursWorked != null) return p.hoursWorked;
  if (!p.clockIn) return 0;
  const start = new Date(p.roundedClockIn ?? p.clockIn).getTime();
  const end = p.clockOut ? new Date(p.roundedClockOut ?? p.clockOut).getTime() : now.getTime();
  if (!(end > start)) return 0;
  const breakMs = (p.breakMinutes || 0) * 60 * 1000;
  return Math.max(0, (end - start - breakMs) / (1000 * 60 * 60));
}

/**
 * Worked hours for a single day's punches (break-deducted, via punchWorkedHours).
 */
function computeDayHours(punches: PunchLog[], now: Date = new Date()): number {
  let hours = 0;
  for (const p of punches) {
    hours += punchWorkedHours(p, now);
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
): { totalHours: number; daysWorked: number } {
  const daysWorked = new Set<string>();
  let totalHours = 0;
  for (const p of punches) {
    if (!p.clockIn) continue;
    totalHours += punchWorkedHours(p, now);
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
        if (p.clockOut) {
          const t = new Date(p.clockOut);
          if (!lastOut || t > lastOut) lastOut = t;
        }
        breakMin += p.breakMinutes || 0;
        if (p.status === "in-progress") {
          inProgress = true;
        } else if (p.clockIn && !p.clockOut && !p.hoursWorked) {
          missingPunch = true;
        }
      }

      // Hours + combined overtime come straight from the ledger row for this
      // day (the materialized engine split). Fall back to the raw worked-hours
      // sum only for a zero/edge day the ledger doesn't persist a row for.
      const ledgerDay = ledgerByDate.get(dateStr);
      const roundedHours = ledgerDay
        ? ledgerDay.totalHours
        : Math.round(computeDayHours(datePunches, now) * 100) / 100;
      // The timesheet's one "Overtime" column shows OT + double-time combined;
      // holidayOtExclusion (when set) already zeroed these in the ledger.
      const dayOvertime = ledgerDay
        ? Math.round((ledgerDay.overtimeHours + ledgerDay.doubleTimeHours) * 100) / 100
        : 0;

      let status: TimesheetStatus;
      if (inProgress) status = "in_progress";
      else if (missingPunch) status = "missing_punch";
      else if (ledgerDay?.status === "overtime") status = "overtime";
      else status = "complete";

      const entry: TimesheetEntry = {
        date: dateStr,
        dayOfWeek,
        clockIn: firstIn ? firstIn.toISOString() : null,
        clockOut: lastOut ? lastOut.toISOString() : null,
        breakMinutes: breakMin,
        totalHours: roundedHours,
        overtimeHours: inProgress ? 0 : dayOvertime,
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

  return {
    otThresholdDaily: otThreshold,
    entries,
    totals: {
      totalHours: Math.round(ledgerTotals.totalHours * 10) / 10,
      overtimeHours: Math.round(ledgerTotals.overtimeCombined * 10) / 10,
      daysWorked: ledgerTotals.daysWorked,
    },
  };
}
