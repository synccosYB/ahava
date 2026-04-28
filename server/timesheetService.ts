import type { PunchLog, TimeOffRequest, User } from "@shared/schema";
import { storage } from "./storage";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES } from "./policyEngine";

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

type AttendanceRulesShape = Partial<typeof DEFAULT_ATTENDANCE_RULES>;

/**
 * Compute wall-clock hours worked for a single day's punches, matching the
 * existing /api/reports/generate logic: sum of (clockOut - clockIn). For an
 * in-progress punch (no clockOut), use the current time.
 */
function computeDayHours(punches: PunchLog[], now: Date = new Date()): number {
  let hours = 0;
  for (const p of punches) {
    if (!p.clockIn) continue;
    const start = new Date(p.clockIn).getTime();
    const end = p.clockOut ? new Date(p.clockOut).getTime() : now.getTime();
    if (end > start) {
      hours += (end - start) / (1000 * 60 * 60);
    }
  }
  return hours;
}

/**
 * Aggregate-only variant used by the time report. Returns the same totals the
 * /api/reports/generate endpoint would produce for one employee. Sharing this
 * helper guarantees the per-employee timesheet totals match the time report.
 */
export function computeAttendanceTotals(
  punches: PunchLog[],
  now: Date = new Date(),
): { totalHours: number; daysWorked: number } {
  const daysWorked = new Set<string>();
  let totalHours = 0;
  for (const p of punches) {
    if (!p.clockIn) continue;
    const start = new Date(p.clockIn).getTime();
    const end = p.clockOut ? new Date(p.clockOut).getTime() : now.getTime();
    if (end > start) {
      totalHours += (end - start) / (1000 * 60 * 60);
    }
    daysWorked.add(p.workDate);
  }
  return { totalHours, daysWorked: daysWorked.size };
}

/**
 * Build a per-day timesheet for an employee over a date range, plus aggregate
 * totals that exactly match the existing time report formula
 * (overtime = max(0, totalHours - daysWorked * 8)).
 *
 * Per-day overtime is also surfaced (using the policy's daily OT threshold)
 * for display purposes only; it is not summed into the aggregate totals.
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

  const policy = await getEffectivePolicy(employee.companyId, employee.id, "attendance", employee);
  const rules = (policy?.rules as AttendanceRulesShape | undefined) || DEFAULT_ATTENDANCE_RULES;
  const otThreshold = rules.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;

  const punchesByDate = new Map<string, PunchLog[]>();
  for (const p of punches) {
    const arr = punchesByDate.get(p.workDate) || [];
    arr.push(p);
    punchesByDate.set(p.workDate, arr);
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
      const dayOvertime = Math.max(0, Math.round((dayHours - otThreshold) * 100) / 100);

      let status: TimesheetStatus;
      if (inProgress) status = "in_progress";
      else if (missingPunch) status = "missing_punch";
      else if (dayHours > otThreshold) status = "overtime";
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
      });
    }
  }

  // Aggregate totals must match the existing /api/reports/generate formula so
  // numbers are consistent across the per-employee timesheet and the time
  // report. That formula uses wall-clock duration and aggregate weekly OT.
  const { totalHours, daysWorked } = computeAttendanceTotals(punches, now);
  const aggregateOvertime = Math.max(0, totalHours - daysWorked * 8);

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
