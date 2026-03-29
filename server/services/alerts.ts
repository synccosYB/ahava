import { db } from "../db";
import { punchLogs, users, policies, policyRules, policyAssignments, policyTypes } from "@shared/schema";
import { eq, and, lte, gte, isNull, ne, desc, sql } from "drizzle-orm";
import { storage } from "../storage";

export type AlertType =
  | "missing_clock_out"
  | "late_clock_in"
  | "overtime_threshold"
  | "no_show"
  | "repeated_exception";

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

export async function detectOvertimeThreshold(thresholdHours: number = 40): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const weekStart = monday.toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  const allUsers = await storage.getAllUsers();

  for (const user of allUsers) {
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
        details: { weekHours: Math.round(weekHours * 10) / 10, threshold: thresholdHours, weekStart },
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
    const noShows = await detectNoShows();
    allAlerts.push(...noShows);
  } catch (e) {
    console.error("Alert detection - no-shows error:", e);
  }

  return allAlerts;
}
