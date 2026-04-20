import { db } from "./db";
import {
  policies,
  policyRules,
  policyAssignments,
  policyTypes,
  type Policy,
  type PolicyRule,
  type User,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface EffectivePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string;
  assignmentLevel: "global" | "division" | "location" | "department" | "employee";
  rules: Record<string, any>;
}

export async function getEffectivePolicy(
  companyId: string | null,
  userId: string,
  policyTypeKey: string,
  user?: User
): Promise<EffectivePolicy | null> {
  const [policyType] = await db
    .select()
    .from(policyTypes)
    .where(eq(policyTypes.key, policyTypeKey));

  if (!policyType) return null;

  const allAssignments = await db
    .select({
      assignment: policyAssignments,
      policy: policies,
    })
    .from(policyAssignments)
    .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
    .where(
      and(
        eq(policies.policyTypeId, policyType.id),
        eq(policies.status, "active")
      )
    );

  let resolvedPolicy: Policy | null = null;
  let assignmentLevel: EffectivePolicy["assignmentLevel"] = "division";

  const employeeMatch = allAssignments.find(
    (a) => a.assignment.userId === userId
  );
  if (employeeMatch) {
    resolvedPolicy = employeeMatch.policy;
    assignmentLevel = "employee";
  }

  if (!resolvedPolicy && user?.departmentId) {
    const deptMatch = allAssignments.find(
      (a) =>
        a.assignment.departmentId === user.departmentId &&
        !a.assignment.userId
    );
    if (deptMatch) {
      resolvedPolicy = deptMatch.policy;
      assignmentLevel = "department";
    }
  }

  if (!resolvedPolicy && user?.locationId) {
    const locMatch = allAssignments.find(
      (a) =>
        a.assignment.locationId === user.locationId &&
        !a.assignment.departmentId &&
        !a.assignment.userId
    );
    if (locMatch) {
      resolvedPolicy = locMatch.policy;
      assignmentLevel = "location";
    }
  }

  if (!resolvedPolicy && companyId) {
    const companyMatch = allAssignments.find(
      (a) =>
        a.assignment.companyId === companyId &&
        !a.assignment.locationId &&
        !a.assignment.departmentId &&
        !a.assignment.userId
    );
    if (companyMatch) {
      resolvedPolicy = companyMatch.policy;
      assignmentLevel = "division";
    }
  }

  if (!resolvedPolicy) {
    const globalMatch = allAssignments.find(
      (a) =>
        !a.assignment.companyId &&
        !a.assignment.locationId &&
        !a.assignment.departmentId &&
        !a.assignment.userId
    );
    if (globalMatch) {
      resolvedPolicy = globalMatch.policy;
      assignmentLevel = "global";
    }
  }

  if (!resolvedPolicy) return null;

  const [rule] = await db
    .select()
    .from(policyRules)
    .where(eq(policyRules.policyId, resolvedPolicy.id))
    .limit(1);

  return {
    policyId: resolvedPolicy.id,
    policyName: resolvedPolicy.name,
    policyTypeKey,
    assignmentLevel,
    rules: (rule?.rules as Record<string, any>) || {},
  };
}

export const DEFAULT_ATTENDANCE_RULES = {
  gracePeriodMinutes: 5,
  roundingRule: "nearest_15",
  roundingIntervalMinutes: 15,
  otThresholdDaily: 8,
  otThresholdWeekly: 40,
  allowedPunchSources: ["web", "kiosk", "mobile"],
  autoClockOutEnabled: false,
  autoClockOutAfterHours: 16,
  requireBreakAfterHours: 6,
  breakDurationMinutes: 30,
};

export const DEFAULT_PTO_RULES = {
  accrualType: "annual",
  accrualRate: 15,
  yearlyCapHours: null,
  carryoverCapHours: 0,
  waitingPeriodDays: 0,
  sickAccrualEnabled: true,
  sickAccrualRatePerHours: 1,
  sickAccrualPerHoursWorked: 30,
  sickYearlyCapHours: 40,
  personalDaysPerYear: 5,
  holidayPayEnabled: true,
  holidayPtoDeduction: false,
  holidayOtExclusion: true,
  requireApproval: true,
  maxConsecutiveDays: 10,
  blackoutDates: [],
};

export const DEFAULT_PAYROLL_RULES = {
  payPeriod: "biweekly",
  payDay: "friday",
  overtimeMultiplier: 1.5,
  doubleTimeMultiplier: 2.0,
  doubleTimeThresholdDaily: 12,
  includeHolidayPay: true,
  autoCalculateOT: true,
  dayOfWeekBonuses: [] as Array<{
    id: string;
    dayOfWeek: number;
    minHoursThreshold: number;
    bonusType: "money" | "hours";
    bonusAmount: number;
  }>,
  earlyArrivalBonuses: [] as Array<{
    id: string;
    cutoffTime: string;
    bonusAmountPerHour: number;
    minHoursThreshold: number;
    daysOfWeek?: number[];
  }>,
};

export const DEFAULT_APPROVALS_RULES = {
  ptoApprovalChain: ["direct_manager"],
  attendanceCorrectionApproval: ["direct_manager"],
  autoApproveAfterDays: 0,
  requireCommentOnDenial: true,
  notifyOnSubmission: true,
  notifyOnDecision: true,
};

export const DEFAULT_ALERTS_RULES = {
  lateArrivalThresholdMinutes: 15,
  absentNotificationEnabled: true,
  overtimeAlertEnabled: true,
  overtimeAlertThresholdWeekly: 45,
  ptoBalanceLowThreshold: 2,
  notifyManager: true,
  notifyHR: false,
  notifyEmployee: true,
};

export const DEFAULT_KIOSK_RULES = {
  requirePin: true,
  allowNameSearch: true,
  sessionTimeoutSeconds: 30,
  showLastPunch: true,
  allowBreakPunch: false,
  photoVerification: false,
  restrictToDepartment: false,
};

export function getDefaultRulesForType(policyTypeKey: string): Record<string, any> {
  switch (policyTypeKey) {
    case "attendance":
      return { ...DEFAULT_ATTENDANCE_RULES };
    case "pto":
      return { ...DEFAULT_PTO_RULES };
    case "payroll":
      return { ...DEFAULT_PAYROLL_RULES };
    case "approvals":
      return { ...DEFAULT_APPROVALS_RULES };
    case "alerts":
      return { ...DEFAULT_ALERTS_RULES };
    case "kiosk":
      return { ...DEFAULT_KIOSK_RULES };
    default:
      return {};
  }
}
