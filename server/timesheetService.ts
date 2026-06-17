import type { PunchLog, TimeOffRequest, User } from "@shared/schema";
import { storage } from "./storage";
import { DEFAULT_ATTENDANCE_RULES } from "./policyEngine";
import { resolvePayCalcPolicy, splitDailyHours } from "./payrollEngine";

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

  // Full effective pay policy (attendance + payroll + pto) drives the split.
  const payCalc = await resolvePayCalcPolicy(employee);
  const otThreshold = payCalc.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
  // Holiday detection mirrors the payroll batch / reconciliation logic: a day
  // worked outside the employee's active scheduled days is treated as a holiday,
  // so holidayOtExclusion (when set) keeps that day's hours all-regular.
  const schedules = await storage.getEmployeeSchedules(employee.id);
  const scheduledDays = schedules.filter((s) => s.isActive).map((s) => s.dayOfWeek);
  const dayOfWeekForDate = (dateStr: string): number => {
    const parts = dateStr.split("-");
    return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))).getUTCDay();
  };
  const isHolidayDay = (dateStr: string): boolean =>
    scheduledDays.length > 0 && !scheduledDays.includes(dayOfWeekForDate(dateStr));

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

      const dayHours = computeDayHours(datePunches, now);
      const roundedHours = Math.round(dayHours * 100) / 100;
      // Single authoritative split. The timesheet's one "Overtime" column shows
      // OT + double-time combined; holidayOtExclusion (when set) zeroes it out.
      const split = splitDailyHours(dayHours, payCalc, { isHoliday: isHolidayDay(dateStr) });
      const dayOvertime = Math.round((split.overtimeHours + split.doubleTimeHours) * 100) / 100;

      let status: TimesheetStatus;
      if (inProgress) status = "in_progress";
      else if (missingPunch) status = "missing_punch";
      else if (split.status === "overtime") status = "overtime";
      else status = "complete";

      entries.push({
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
      });
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

  // Aggregate totals share the unified pay engine's per-day overtime model so
  // numbers stay consistent across the per-employee timesheet, the time report
  // and payroll: overtime is summed per day (each day's hours over the daily
  // threshold), NOT the old "totalHours - daysWorked * 8" approximation (which
  // let a long day net against a short day).
  const { totalHours, daysWorked } = computeAttendanceTotals(punches, now);
  const aggregateOvertime = entries.reduce((sum, e) => sum + (e.overtimeHours || 0), 0);

  return {
    otThresholdDaily: otThreshold,
    entries,
    totals: {
      totalHours: Math.round(totalHours * 10) / 10,
      overtimeHours: Math.round(aggregateOvertime * 10) / 10,
      daysWorked,
    },
  };
}
