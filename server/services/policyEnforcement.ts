import { storage } from "../storage";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES, DEFAULT_PTO_RULES, DEFAULT_PAYROLL_RULES } from "../policyEngine";
import type { User } from "@shared/schema";

export interface DayOfWeekBonusRule {
  id: string;
  dayOfWeek: number;
  minHoursThreshold: number;
  bonusType: "money" | "hours";
  bonusAmount: number;
}

export interface DayOfWeekBonusResult {
  bonusAmount: number;
  bonusHours: number;
  descriptions: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface EarlyArrivalBonusRule {
  id: string;
  cutoffTime: string;
  bonusAmountPerHour: number;
  minHoursThreshold: number;
  daysOfWeek?: number[];
}

export interface EarlyArrivalBonusResult {
  bonusAmount: number;
  descriptions: string[];
}

export function evaluateEarlyArrivalBonuses(
  workDate: string,
  clockIn: Date | string | null | undefined,
  hoursWorked: number,
  payrollRules: Record<string, any>,
): EarlyArrivalBonusResult {
  const result: EarlyArrivalBonusResult = { bonusAmount: 0, descriptions: [] };
  const bonuses: EarlyArrivalBonusRule[] = Array.isArray(payrollRules?.earlyArrivalBonuses)
    ? payrollRules.earlyArrivalBonuses
    : [];
  if (bonuses.length === 0 || !clockIn || !workDate) return result;

  const clockInDate = clockIn instanceof Date ? clockIn : new Date(clockIn);
  if (isNaN(clockInDate.getTime())) return result;
  const clockInMinutes = clockInDate.getHours() * 60 + clockInDate.getMinutes();

  const parts = workDate.split("-");
  let dayOfWeek: number | null = null;
  if (parts.length === 3) {
    const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    dayOfWeek = d.getUTCDay();
  }

  for (const rule of bonuses) {
    if (!rule || typeof rule.cutoffTime !== "string") continue;
    const [hStr, mStr] = rule.cutoffTime.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const cutoffMinutes = h * 60 + m;
    if (clockInMinutes >= cutoffMinutes) continue;

    const threshold = Number(rule.minHoursThreshold) || 0;
    if (hoursWorked < threshold) continue;

    if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0 && dayOfWeek !== null) {
      if (!rule.daysOfWeek.includes(dayOfWeek)) continue;
    }

    const perHour = Number(rule.bonusAmountPerHour) || 0;
    if (perHour <= 0) continue;

    const bonus = perHour * (Number(hoursWorked) || 0);
    if (bonus <= 0) continue;
    result.bonusAmount += bonus;
    result.descriptions.push(
      `Early-arrival bonus (before ${rule.cutoffTime}): +$${perHour.toFixed(2)}/hr × ${hoursWorked}h = $${bonus.toFixed(2)}`,
    );
  }

  result.bonusAmount = Math.round(result.bonusAmount * 100) / 100;
  return result;
}

export function evaluateDayOfWeekBonuses(
  workDate: string,
  hoursWorked: number,
  payrollRules: Record<string, any>
): DayOfWeekBonusResult {
  const result: DayOfWeekBonusResult = { bonusAmount: 0, bonusHours: 0, descriptions: [] };
  const bonuses: DayOfWeekBonusRule[] = Array.isArray(payrollRules?.dayOfWeekBonuses)
    ? payrollRules.dayOfWeekBonuses
    : [];
  if (bonuses.length === 0 || !workDate) return result;

  const parts = workDate.split("-");
  if (parts.length !== 3) return result;
  const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  const dayOfWeek = d.getUTCDay();

  for (const rule of bonuses) {
    if (rule.dayOfWeek !== dayOfWeek) continue;
    const threshold = Number(rule.minHoursThreshold) || 0;
    if (hoursWorked < threshold) continue;
    const amount = Number(rule.bonusAmount) || 0;
    if (amount <= 0) continue;

    if (rule.bonusType === "hours") {
      result.bonusHours += amount;
      result.descriptions.push(`${DAY_NAMES[dayOfWeek]} bonus: +${amount}h (≥${threshold}h)`);
    } else {
      result.bonusAmount += amount;
      result.descriptions.push(`${DAY_NAMES[dayOfWeek]} bonus: +$${amount.toFixed(2)} (≥${threshold}h)`);
    }
  }

  result.bonusAmount = Math.round(result.bonusAmount * 100) / 100;
  result.bonusHours = Math.round(result.bonusHours * 100) / 100;
  return result;
}

export function roundTime(date: Date, rule: string, intervalMinutes: number): Date {
  const ms = date.getTime();
  const intervalMs = intervalMinutes * 60 * 1000;
  if (intervalMs <= 0) return date;

  switch (rule) {
    case "nearest": {
      const rounded = Math.round(ms / intervalMs) * intervalMs;
      return new Date(rounded);
    }
    case "nearest_15": {
      const iv = 15 * 60 * 1000;
      return new Date(Math.round(ms / iv) * iv);
    }
    case "nearest_5": {
      const iv = 5 * 60 * 1000;
      return new Date(Math.round(ms / iv) * iv);
    }
    case "nearest_6": {
      const iv = 6 * 60 * 1000;
      return new Date(Math.round(ms / iv) * iv);
    }
    case "round_up": {
      const rounded = Math.ceil(ms / intervalMs) * intervalMs;
      return new Date(rounded);
    }
    case "round_down": {
      const rounded = Math.floor(ms / intervalMs) * intervalMs;
      return new Date(rounded);
    }
    case "none":
    default:
      return date;
  }
}

export interface ClockInEnforcementResult {
  allowed: boolean;
  rejectionMessage?: string;
  roundedTime: Date;
  isLate: boolean;
  lateMinutes: number;
  alerts: PolicyAlert[];
  scheduleStart?: number;
}

export interface PolicyAlert {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  employeeId: string;
  message: string;
  details: Record<string, unknown>;
}

export async function enforceClockIn(
  user: User,
  now: Date,
  rules: Record<string, any>,
  policyName?: string
): Promise<ClockInEnforcementResult> {
  const alerts: PolicyAlert[] = [];
  const gracePeriodMinutes = rules.gracePeriodMinutes ?? DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes;
  const roundingRule = rules.roundingRule ?? DEFAULT_ATTENDANCE_RULES.roundingRule;
  const roundingInterval = rules.roundingIntervalMinutes ?? DEFAULT_ATTENDANCE_RULES.roundingIntervalMinutes;
  const earlyClockInWindow = rules.earlyClockInWindowMinutes;

  const roundedTime = roundTime(now, roundingRule, roundingInterval);

  const dayOfWeek = now.getDay();
  const schedule = await storage.getEmployeeScheduleByDay(user.id, dayOfWeek);

  let isLate = false;
  let lateMinutes = 0;
  let scheduleStart: number | undefined;

  if (schedule) {
    const [startH, startM] = schedule.startTime.split(":").map(Number);
    scheduleStart = startH * 60 + startM;
    const currentMinutes = roundedTime.getHours() * 60 + roundedTime.getMinutes();
    const diff = currentMinutes - scheduleStart;

    if (earlyClockInWindow !== undefined && earlyClockInWindow !== null && diff < 0) {
      const earlyMinutes = Math.abs(diff);
      if (earlyMinutes > earlyClockInWindow) {
        return {
          allowed: false,
          rejectionMessage: `Early clock-in is not allowed more than ${earlyClockInWindow} minutes before your shift starts at ${schedule.startTime}.`,
          roundedTime,
          isLate: false,
          lateMinutes: 0,
          alerts: [],
          scheduleStart,
        };
      }
    }

    if (diff > gracePeriodMinutes) {
      isLate = true;
      lateMinutes = diff;
      alerts.push({
        type: "late_clock_in",
        severity: diff > 30 ? "high" : "medium",
        employeeId: user.id,
        message: `Late arrival: ${lateMinutes} minutes past scheduled start (${schedule.startTime}). Grace period: ${gracePeriodMinutes} min.`,
        details: {
          scheduledStart: schedule.startTime,
          actualClockIn: roundedTime.toISOString(),
          lateMinutes,
          gracePeriodMinutes,
          ruleViolated: "gracePeriodMinutes",
          policyName: policyName || "Default",
          policyRules: { gracePeriodMinutes, roundingRule },
        },
      });
    }
  }

  return {
    allowed: true,
    roundedTime,
    isLate,
    lateMinutes,
    alerts,
    scheduleStart,
  };
}

export interface ClockOutEnforcementResult {
  roundedTime: Date;
  hoursWorked: number;
  overtimeHours: number;
  doubleTimeHours: number;
  overtimeMultiplier: number;
  doubleTimeMultiplier: number;
  status: string;
  alerts: PolicyAlert[];
}

export function enforceClockOut(
  clockInTime: Date,
  now: Date,
  breakMinutes: number,
  rules: Record<string, any>,
  payrollRules: Record<string, any>,
  user: User,
  policyName?: string
): ClockOutEnforcementResult {
  const alerts: PolicyAlert[] = [];
  const roundingRule = rules.roundingRule ?? DEFAULT_ATTENDANCE_RULES.roundingRule;
  const roundingInterval = rules.roundingIntervalMinutes ?? DEFAULT_ATTENDANCE_RULES.roundingIntervalMinutes;
  const otThresholdDaily = rules.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
  const requireBreakAfterHours = rules.requireBreakAfterHours ?? DEFAULT_ATTENDANCE_RULES.requireBreakAfterHours;
  const breakDurationMinutes = rules.breakDurationMinutes ?? DEFAULT_ATTENDANCE_RULES.breakDurationMinutes;

  const roundedTime = roundTime(now, roundingRule, roundingInterval);

  const totalMs = roundedTime.getTime() - clockInTime.getTime();
  const breakMs = (breakMinutes || 0) * 60 * 1000;
  const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

  const shiftHours = totalMs / (1000 * 60 * 60);
  if (requireBreakAfterHours && shiftHours > requireBreakAfterHours && breakMinutes < breakDurationMinutes) {
    alerts.push({
      type: "break_violation",
      severity: "medium",
      employeeId: user.id,
      message: `Shift of ${Math.round(shiftHours * 10) / 10} hours exceeded ${requireBreakAfterHours}-hour break requirement. Required break: ${breakDurationMinutes} min, taken: ${breakMinutes} min.`,
      details: {
        shiftHours: Math.round(shiftHours * 10) / 10,
        requireBreakAfterHours,
        breakDurationMinutes,
        breakMinutesTaken: breakMinutes,
        ruleViolated: "requireBreakAfterHours",
        policyName: policyName || "Default",
      },
    });
  }

  const overtimeMultiplier = payrollRules.overtimeMultiplier ?? DEFAULT_PAYROLL_RULES.overtimeMultiplier;
  const doubleTimeMultiplier = payrollRules.doubleTimeMultiplier ?? DEFAULT_PAYROLL_RULES.doubleTimeMultiplier;
  const doubleTimeThresholdDaily = payrollRules.doubleTimeThresholdDaily ?? DEFAULT_PAYROLL_RULES.doubleTimeThresholdDaily;

  let overtimeHours = 0;
  let doubleTimeHours = 0;
  let status = "complete";

  if (hoursWorked > otThresholdDaily) {
    status = "overtime";
    const totalOtHours = hoursWorked - otThresholdDaily;

    if (doubleTimeThresholdDaily && hoursWorked > doubleTimeThresholdDaily) {
      doubleTimeHours = Math.round((hoursWorked - doubleTimeThresholdDaily) * 100) / 100;
      overtimeHours = Math.round((doubleTimeThresholdDaily - otThresholdDaily) * 100) / 100;
    } else {
      overtimeHours = Math.round(totalOtHours * 100) / 100;
    }
  }

  return {
    roundedTime,
    hoursWorked,
    overtimeHours,
    doubleTimeHours,
    overtimeMultiplier,
    doubleTimeMultiplier,
    status,
    alerts,
  };
}

export interface PtoEnforcementResult {
  allowed: boolean;
  rejectionMessage?: string;
}

export function enforcePtoAdvanceNotice(
  startDate: string,
  rules: Record<string, any>
): PtoEnforcementResult {
  const advanceNoticeDays = rules.advanceNoticeDays;
  if (advanceNoticeDays === undefined || advanceNoticeDays === null || advanceNoticeDays <= 0) {
    return { allowed: true };
  }

  const startMs = new Date(startDate + "T00:00:00Z").getTime();
  const todayStr = new Date().toISOString().split("T")[0];
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const daysDiff = Math.floor((startMs - todayMs) / (24 * 60 * 60 * 1000));

  if (daysDiff < advanceNoticeDays) {
    return {
      allowed: false,
      rejectionMessage: `Time-off requests require at least ${advanceNoticeDays} day(s) advance notice. Your request starts in ${daysDiff} day(s).`,
    };
  }

  return { allowed: true };
}

export function enforcePtoBlackoutDates(
  startDate: string,
  endDate: string,
  rules: Record<string, any>
): PtoEnforcementResult {
  const blackoutDates: string[] = rules.blackoutDates || [];
  if (blackoutDates.length === 0) {
    return { allowed: true };
  }

  const startMs = new Date(startDate + "T00:00:00Z").getTime();
  const endMs = new Date(endDate + "T00:00:00Z").getTime();

  for (const blackout of blackoutDates) {
    const blackoutMs = new Date(blackout + "T00:00:00Z").getTime();
    if (blackoutMs >= startMs && blackoutMs <= endMs) {
      return {
        allowed: false,
        rejectionMessage: `Your request overlaps with a blackout date (${blackout}). Time-off cannot be taken on blackout dates.`,
      };
    }
  }

  return { allowed: true };
}

export async function runAutoClockOut(): Promise<PolicyAlert[]> {
  const alerts: PolicyAlert[] = [];
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
    const now = new Date();
    const hoursOpen = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

    if (hoursOpen >= autoClockOutAfterHours) {
      const autoClockOutTime = new Date(clockInTime.getTime() + autoClockOutAfterHours * 60 * 60 * 1000);
      const breakMs = (punch.breakMinutes || 0) * 60 * 1000;
      const totalMs = autoClockOutTime.getTime() - clockInTime.getTime();
      const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

      const otThreshold = rules.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
      const status = hoursWorked > otThreshold ? "overtime" : "complete";

      await storage.updatePunchLog(punch.id, {
        clockOut: autoClockOutTime,
        hoursWorked,
        status,
      });

      alerts.push({
        type: "auto_clock_out",
        severity: "high",
        employeeId: punch.employeeId,
        message: `Auto clock-out: Employee was automatically clocked out after ${autoClockOutAfterHours} hours (open since ${clockInTime.toISOString()}). Hours recorded: ${hoursWorked}.`,
        details: {
          punchLogId: punch.id,
          clockIn: clockInTime.toISOString(),
          autoClockOut: autoClockOutTime.toISOString(),
          hoursWorked,
          autoClockOutAfterHours,
          policyName: attendancePolicy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

export async function createPolicyAlert(alert: PolicyAlert): Promise<void> {
  try {
    const existing = await storage.getAllSystemAlerts({ type: alert.type, status: "open" });
    const isDuplicate = existing.some(e =>
      e.employeeId === alert.employeeId && e.message === alert.message
    );
    if (!isDuplicate) {
      await storage.createSystemAlert({
        type: alert.type,
        severity: alert.severity,
        status: "open",
        employeeId: alert.employeeId,
        message: alert.message,
        details: alert.details,
      });
    }
  } catch (err) {
    console.error("Failed to create policy alert:", err);
  }
}

export async function createPolicyAlerts(alerts: PolicyAlert[]): Promise<void> {
  for (const alert of alerts) {
    await createPolicyAlert(alert);
  }
}
