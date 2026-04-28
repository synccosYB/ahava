import { db } from "../db";
import { punchLogs, users, policies, policyRules, policyAssignments, policyTypes } from "@shared/schema";
import { eq, and, lte, gte, isNull, ne, desc, sql } from "drizzle-orm";
import { storage } from "../storage";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES } from "../policyEngine";

export type AlertType =
  | "missing_clock_out"
  | "late_clock_in"
  | "overtime_threshold"
  | "no_show"
  | "repeated_exception"
  | "break_violation"
  | "auto_clock_out"
  | "review_due"
  | "missing_document"
  | "certification_expiring"
  | "certification_expired";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface GeneratedAlert {
  type: AlertType;
  severity: AlertSeverity;
  employeeId: string;
  message: string;
  details: Record<string, unknown>;
}

export async function detectMissingClockOuts(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const openPunches = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        lte(punchLogs.workDate, yesterdayStr),
        isNull(punchLogs.clockOut),
        eq(punchLogs.status, "in-progress")
      )
    );

  for (const punch of openPunches) {
    alerts.push({
      type: "missing_clock_out",
      severity: "high",
      employeeId: punch.employeeId,
      message: `Missing clock-out for ${punch.workDate}`,
      details: { punchLogId: punch.id, workDate: punch.workDate, clockIn: punch.clockIn },
    });
  }

  return alerts;
}

export async function detectOvertimeThreshold(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const weekStart = monday.toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  const allUsers = await storage.getAllUsers();

  for (const user of allUsers) {
    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
    const thresholdHours = rules.otThresholdWeekly ?? DEFAULT_ATTENDANCE_RULES.otThresholdWeekly;

    const records = await db
      .select()
      .from(punchLogs)
      .where(
        and(
          eq(punchLogs.employeeId, user.id),
          gte(punchLogs.workDate, weekStart),
          lte(punchLogs.workDate, today)
        )
      );

    let weekHours = 0;
    for (const r of records) {
      if (r.hoursWorked) weekHours += r.hoursWorked;
      else if (r.clockIn) {
        const end = r.clockOut ? new Date(r.clockOut) : new Date();
        weekHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
      }
    }

    if (weekHours >= thresholdHours) {
      alerts.push({
        type: "overtime_threshold",
        severity: weekHours >= thresholdHours * 1.25 ? "critical" : "high",
        employeeId: user.id,
        message: `Weekly hours (${Math.round(weekHours * 10) / 10}h) exceed threshold (${thresholdHours}h)`,
        details: {
          weekHours: Math.round(weekHours * 10) / 10,
          threshold: thresholdHours,
          weekStart,
          policyName: attendancePolicy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

export async function detectBreakViolations(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const today = new Date().toISOString().split("T")[0];

  const completedPunches = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        eq(punchLogs.workDate, today),
        ne(punchLogs.status, "in-progress")
      )
    );

  for (const punch of completedPunches) {
    if (!punch.clockIn || !punch.clockOut) continue;

    const user = await storage.getUser(punch.employeeId);
    if (!user) continue;

    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
    const requireBreakAfterHours = rules.requireBreakAfterHours ?? DEFAULT_ATTENDANCE_RULES.requireBreakAfterHours;
    const breakDurationMinutes = rules.breakDurationMinutes ?? DEFAULT_ATTENDANCE_RULES.breakDurationMinutes;

    const shiftMs = new Date(punch.clockOut).getTime() - new Date(punch.clockIn).getTime();
    const shiftHours = shiftMs / (1000 * 60 * 60);
    const breakMinutes = punch.breakMinutes || 0;

    if (requireBreakAfterHours && shiftHours > requireBreakAfterHours && breakMinutes < breakDurationMinutes) {
      alerts.push({
        type: "break_violation" as AlertType,
        severity: "medium",
        employeeId: punch.employeeId,
        message: `Break violation: ${Math.round(shiftHours * 10) / 10}h shift without required ${breakDurationMinutes} min break (took ${breakMinutes} min).`,
        details: {
          punchLogId: punch.id,
          workDate: punch.workDate,
          shiftHours: Math.round(shiftHours * 10) / 10,
          requireBreakAfterHours,
          breakDurationMinutes,
          breakMinutesTaken: breakMinutes,
          policyName: attendancePolicy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

export async function detectNoShows(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const day = yesterday.getDay();
  if (day === 0 || day === 6) return alerts;

  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const allUsers = await storage.getAllUsers();

  for (const user of allUsers) {
    if (user.role === "admin") continue;

    const records = await db
      .select()
      .from(punchLogs)
      .where(
        and(
          eq(punchLogs.employeeId, user.id),
          eq(punchLogs.workDate, yesterdayStr)
        )
      );

    if (records.length === 0) {
      const timeOffRequests = await storage.getTimeOffRequestsByUser(user.id);
      const hasApprovedLeave = timeOffRequests.some(
        (r) =>
          r.status === "approved" &&
          r.startDate <= yesterdayStr &&
          r.endDate >= yesterdayStr
      );

      if (!hasApprovedLeave) {
        alerts.push({
          type: "no_show",
          severity: "medium",
          employeeId: user.id,
          message: `No attendance record for ${yesterdayStr}`,
          details: { date: yesterdayStr },
        });
      }
    }
  }

  return alerts;
}

export async function detectLateArrivals(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const today = new Date().toISOString().split("T")[0];

  const todayPunches = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.workDate, today));

  for (const punch of todayPunches) {
    if (!punch.clockIn) continue;

    const user = await storage.getUser(punch.employeeId);
    if (!user) continue;

    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
    const gracePeriodMinutes = rules.gracePeriodMinutes ?? DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes;

    const clockInDate = new Date(punch.clockIn);
    const dayOfWeek = clockInDate.getDay();
    const schedule = await storage.getEmployeeScheduleByDay(user.id, dayOfWeek);
    if (!schedule) continue;

    const [startH, startM] = schedule.startTime.split(":").map(Number);
    const scheduleStart = startH * 60 + startM;
    const clockInMinutes = clockInDate.getHours() * 60 + clockInDate.getMinutes();
    const diff = clockInMinutes - scheduleStart;

    if (diff > gracePeriodMinutes) {
      alerts.push({
        type: "late_clock_in",
        severity: diff > 30 ? "high" : "medium",
        employeeId: punch.employeeId,
        message: `Late arrival: ${diff} minutes past scheduled start (${schedule.startTime}). Grace period: ${gracePeriodMinutes} min.`,
        details: {
          punchLogId: punch.id,
          workDate: punch.workDate,
          scheduledStart: schedule.startTime,
          actualClockIn: punch.clockIn,
          lateMinutes: diff,
          gracePeriodMinutes,
          policyName: attendancePolicy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

export async function detectStaleOpenPunches(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const openPunches = await storage.getOpenPunchLogs();

  for (const punch of openPunches) {
    if (!punch.clockIn) continue;

    const user = await storage.getUser(punch.employeeId);
    if (!user) continue;

    const attendancePolicy = await getEffectivePolicy(user.companyId, punch.employeeId, "attendance", user);
    const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
    const autoClockOutEnabled = rules.autoClockOutEnabled ?? DEFAULT_ATTENDANCE_RULES.autoClockOutEnabled;
    if (!autoClockOutEnabled) continue;

    const autoClockOutAfterHours = rules.autoClockOutAfterHours ?? DEFAULT_ATTENDANCE_RULES.autoClockOutAfterHours;
    const clockInTime = new Date(punch.clockIn);
    const hoursOpen = (Date.now() - clockInTime.getTime()) / (1000 * 60 * 60);

    if (hoursOpen >= autoClockOutAfterHours) {
      alerts.push({
        type: "auto_clock_out",
        severity: "high",
        employeeId: punch.employeeId,
        message: `Open punch exceeds ${autoClockOutAfterHours}h threshold (open since ${clockInTime.toISOString()}). Auto clock-out eligible.`,
        details: {
          punchLogId: punch.id,
          clockIn: clockInTime.toISOString(),
          hoursOpen: Math.round(hoursOpen * 10) / 10,
          autoClockOutAfterHours,
          policyName: attendancePolicy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

export async function runAlertDetection(): Promise<GeneratedAlert[]> {
  const allAlerts: GeneratedAlert[] = [];

  try {
    const missingClockOuts = await detectMissingClockOuts();
    allAlerts.push(...missingClockOuts);
  } catch (e) {
    console.error("Alert detection - missing clock-outs error:", e);
  }

  try {
    const overtime = await detectOvertimeThreshold();
    allAlerts.push(...overtime);
  } catch (e) {
    console.error("Alert detection - overtime threshold error:", e);
  }

  try {
    const breakViolations = await detectBreakViolations();
    allAlerts.push(...breakViolations);
  } catch (e) {
    console.error("Alert detection - break violations error:", e);
  }

  try {
    const lateArrivals = await detectLateArrivals();
    allAlerts.push(...lateArrivals);
  } catch (e) {
    console.error("Alert detection - late arrivals error:", e);
  }

  try {
    const staleOpenPunches = await detectStaleOpenPunches();
    allAlerts.push(...staleOpenPunches);
  } catch (e) {
    console.error("Alert detection - stale open punches error:", e);
  }

  try {
    const noShows = await detectNoShows();
    allAlerts.push(...noShows);
  } catch (e) {
    console.error("Alert detection - no-shows error:", e);
  }

  try {
    const { detectPerformanceReviewsDue } = await import("./lifecycleAlerts");
    const reviews = await detectPerformanceReviewsDue();
    allAlerts.push(...reviews);
  } catch (e) {
    console.error("Alert detection - performance reviews error:", e);
  }

  try {
    const { detectMissingDocuments, detectExpiringCertifications, syncCertificationStatuses } = await import("./lifecycleAlerts");
    await syncCertificationStatuses();
    const missingDocs = await detectMissingDocuments();
    allAlerts.push(...missingDocs);
    const certs = await detectExpiringCertifications();
    allAlerts.push(...certs);
  } catch (e) {
    console.error("Alert detection - HR compliance error:", e);
  }

  return allAlerts;
}
