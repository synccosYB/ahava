import { db } from "./db";
import {
  policies,
  policyRules,
  policyAssignments,
  policyTypes,
  userRoles,
  userEmploymentProfiles,
  POLICY_ASSIGNMENT_TARGET_FIELDS,
  type Policy,
  type PolicyAssignment,
  type PolicyRule,
  type User,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

type PolicyAssignmentTargetField = (typeof POLICY_ASSIGNMENT_TARGET_FIELDS)[number];

export interface EffectivePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string;
  assignmentLevel:
    | "global"
    | "division"
    | "location"
    | "department"
    | "role"
    | "employment_type"
    | "pay_type"
    | "employee";
  rules: Record<string, any>;
}

const isPureTarget = (
  a: PolicyAssignment,
  keep: readonly PolicyAssignmentTargetField[]
) =>
  POLICY_ASSIGNMENT_TARGET_FIELDS.every((k) =>
    keep.includes(k) ? !!a[k] : !a[k]
  );

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

  let userRoleIds: string[] = [];
  let employmentType: string | null = null;
  let payType: string | null = null;
  if (!resolvedPolicy) {
    const needRoleLookup = allAssignments.some((a) => !!a.assignment.roleId);
    const needEmploymentLookup = allAssignments.some(
      (a) => !!a.assignment.employmentType || !!a.assignment.payType
    );
    if (needRoleLookup) {
      const rows = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      userRoleIds = rows.map((r) => r.roleId);
    }
    if (needEmploymentLookup) {
      const [profile] = await db
        .select({
          employmentType: userEmploymentProfiles.employmentType,
          payType: userEmploymentProfiles.payType,
        })
        .from(userEmploymentProfiles)
        .where(eq(userEmploymentProfiles.userId, userId));
      employmentType = profile?.employmentType ?? null;
      payType = profile?.payType ?? null;
    }
  }

  if (!resolvedPolicy && payType) {
    const payMatch = allAssignments.find(
      (a) => a.assignment.payType === payType && isPureTarget(a.assignment, ["payType"])
    );
    if (payMatch) {
      resolvedPolicy = payMatch.policy;
      assignmentLevel = "pay_type";
    }
  }

  if (!resolvedPolicy && employmentType) {
    const empMatch = allAssignments.find(
      (a) =>
        a.assignment.employmentType === employmentType &&
        isPureTarget(a.assignment, ["employmentType"])
    );
    if (empMatch) {
      resolvedPolicy = empMatch.policy;
      assignmentLevel = "employment_type";
    }
  }

  if (!resolvedPolicy && userRoleIds.length > 0) {
    const roleMatch = allAssignments.find(
      (a) =>
        a.assignment.roleId &&
        userRoleIds.includes(a.assignment.roleId) &&
        isPureTarget(a.assignment, ["roleId"])
    );
    if (roleMatch) {
      resolvedPolicy = roleMatch.policy;
      assignmentLevel = "role";
    }
  }

  if (!resolvedPolicy && user?.departmentId) {
    const deptMatch = allAssignments.find(
      (a) =>
        a.assignment.departmentId === user.departmentId &&
        isPureTarget(a.assignment, ["departmentId"])
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
        isPureTarget(a.assignment, ["locationId"])
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
        isPureTarget(a.assignment, ["companyId"])
    );
    if (companyMatch) {
      resolvedPolicy = companyMatch.policy;
      assignmentLevel = "division";
    }
  }

  if (!resolvedPolicy) {
    const globalMatch = allAssignments.find((a) => isPureTarget(a.assignment, []));
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
  accrualHoursPerYear: 120,
  yearlyCapHours: null,
  carryoverCapHours: 0,
  waitingPeriodDays: 0,
  sickAccrualEnabled: true,
  sickAccrualRatePerHours: 1,
  sickAccrualPerHoursWorked: 30,
  sickYearlyCapHours: 40,
  vacationAccrualPerHoursWorked: 30,
  vacationAccrualHoursPerThreshold: 1,
  personalHoursPerYear: 40,
  holidayPayEnabled: true,
  holidayPtoDeduction: false,
  holidayOtExclusion: true,
  requireApproval: true,
  maxConsecutiveHours: 80,
  blackoutDates: [],
};

export const DEFAULT_PAYROLL_RULES = {
  payPeriodType: "biweekly",
  payDayOfWeek: null as string | null,
  overtimeEnabled: true,
  overtimeMultiplier: 1.5,
  doubleTimeEnabled: true,
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
    applyScope?: "entire_shift" | "before_cutoff";
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

export const DEFAULT_CERTIFICATION_RULES = {
  warningThresholdsDays: [60, 30, 7, 0] as number[],
  expiredAlertEnabled: true,
  expiredReminderEveryDays: 14,
  notifyEmployee: true,
  notifyManager: true,
  notifyHR: true,
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
    case "certifications":
      return { ...DEFAULT_CERTIFICATION_RULES };
    default:
      return {};
  }
}
