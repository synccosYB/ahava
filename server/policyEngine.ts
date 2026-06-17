import { db } from "./db";
import {
  policies,
  policyRules,
  policyAssignments,
  policyTypes,
  policyAcknowledgments,
  userRoles,
  userEmploymentProfiles,
  POLICY_ASSIGNMENT_TARGET_FIELDS,
  type Policy,
  type PolicyAssignment,
  type PolicyRule,
  type PtoPolicy,
  type User,
  userDepartmentIds,
  userLocationIds,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { DEFAULT_ALLOWED_PUNCH_SOURCES } from "@shared/punchSources";

type PolicyAssignmentTargetField = (typeof POLICY_ASSIGNMENT_TARGET_FIELDS)[number];

export interface EffectivePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string;
  /** Version of the resolved policy, for snapshotting / version-aware recompute. */
  version: number;
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

  // Many-to-many membership: an employee matches a department/location-scoped
  // policy if ANY of their assigned departments/locations matches. When more
  // than one assignment qualifies, the tie-break is the first match in the
  // stable query order of `allAssignments` (same DB ordering used elsewhere).
  const memberDeptIds = user ? userDepartmentIds(user) : [];
  if (!resolvedPolicy && memberDeptIds.length > 0) {
    const deptMatch = allAssignments.find(
      (a) =>
        !!a.assignment.departmentId &&
        memberDeptIds.includes(a.assignment.departmentId) &&
        isPureTarget(a.assignment, ["departmentId"])
    );
    if (deptMatch) {
      resolvedPolicy = deptMatch.policy;
      assignmentLevel = "department";
    }
  }

  const memberLocIds = user ? userLocationIds(user) : [];
  if (!resolvedPolicy && memberLocIds.length > 0) {
    const locMatch = allAssignments.find(
      (a) =>
        !!a.assignment.locationId &&
        memberLocIds.includes(a.assignment.locationId) &&
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
    version: resolvedPolicy.version,
    assignmentLevel,
    rules: (rule?.rules as Record<string, any>) || {},
  };
}

export type ApplicablePolicyLevel =
  | "global"
  | "division"
  | "location"
  | "department"
  | "role"
  | "employment_type"
  | "pay_type"
  | "employee";

export interface ApplicablePolicySource {
  level: ApplicablePolicyLevel;
  /** The raw target id for this source (companyId/locationId/etc.), or the raw
   *  employmentType/payType value. Null for a global (no-target) assignment. */
  targetId: string | null;
  /** Effective date of THIS assignment (falls back to its createdAt). */
  effectiveDate: string | null;
}

export interface ApplicablePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string | null;
  status: string;
  version: number;
  requiresAcknowledgment: boolean;
  /** Earliest effective date across all the sources that apply this policy. */
  effectiveDate: string | null;
  sources: ApplicablePolicySource[];
  acknowledgment: {
    required: boolean;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    acknowledgedVersion: number | null;
  };
}

/**
 * List EVERY active policy that applies to a user, regardless of type, and the
 * full set of reasons (sources) each one applies — direct assignment plus any
 * inherited via role / department / location / company / employment type / pay
 * type / global. Unlike `getEffectivePolicy` (which resolves a single winning
 * policy per type by precedence), this returns all of them deduped into one row
 * per policy, with every matching source attached. Powers the employee profile
 * "Policies" tab.
 */
export async function getApplicablePolicies(user: User): Promise<ApplicablePolicy[]> {
  const rows = await db
    .select({
      assignment: policyAssignments,
      policy: policies,
      typeKey: policyTypes.key,
    })
    .from(policyAssignments)
    .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
    .leftJoin(policyTypes, eq(policyTypes.id, policies.policyTypeId))
    .where(eq(policies.status, "active"));

  if (rows.length === 0) return [];

  // Resolve the user's role / employment context once.
  const roleRows = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  const userRoleIds = new Set(roleRows.map((r) => r.roleId));

  const [profile] = await db
    .select({
      employmentType: userEmploymentProfiles.employmentType,
      payType: userEmploymentProfiles.payType,
    })
    .from(userEmploymentProfiles)
    .where(eq(userEmploymentProfiles.userId, user.id));
  const employmentType = profile?.employmentType ?? null;
  const payType = profile?.payType ?? null;

  const memberDeptIds = new Set(userDepartmentIds(user));
  const memberLocIds = new Set(userLocationIds(user));

  const toIso = (d: Date | string | null | undefined): string | null =>
    d ? new Date(d).toISOString() : null;

  // Determine the matching source (if any) for a single assignment row. Each
  // row carries exactly one target field (enforced at write time); legacy rows
  // with no target are treated as global (applies to everyone).
  const matchSource = (a: PolicyAssignment): ApplicablePolicySource | null => {
    const effectiveDate = toIso(a.effectiveDate ?? a.createdAt);
    if (a.userId) {
      return a.userId === user.id ? { level: "employee", targetId: a.userId, effectiveDate } : null;
    }
    if (a.roleId) {
      return userRoleIds.has(a.roleId) ? { level: "role", targetId: a.roleId, effectiveDate } : null;
    }
    if (a.employmentType) {
      return a.employmentType === employmentType
        ? { level: "employment_type", targetId: a.employmentType, effectiveDate }
        : null;
    }
    if (a.payType) {
      return a.payType === payType ? { level: "pay_type", targetId: a.payType, effectiveDate } : null;
    }
    if (a.departmentId) {
      return memberDeptIds.has(a.departmentId)
        ? { level: "department", targetId: a.departmentId, effectiveDate }
        : null;
    }
    if (a.locationId) {
      return memberLocIds.has(a.locationId)
        ? { level: "location", targetId: a.locationId, effectiveDate }
        : null;
    }
    if (a.companyId) {
      return user.companyId && a.companyId === user.companyId
        ? { level: "division", targetId: a.companyId, effectiveDate }
        : null;
    }
    // No target set -> global assignment, applies to everyone.
    return { level: "global", targetId: null, effectiveDate };
  };

  const byPolicy = new Map<
    string,
    {
      policy: Policy;
      typeKey: string | null;
      sources: ApplicablePolicySource[];
    }
  >();

  for (const row of rows) {
    const source = matchSource(row.assignment);
    if (!source) continue;
    let entry = byPolicy.get(row.policy.id);
    if (!entry) {
      entry = { policy: row.policy, typeKey: row.typeKey ?? null, sources: [] };
      byPolicy.set(row.policy.id, entry);
    }
    entry.sources.push(source);
  }

  if (byPolicy.size === 0) return [];

  // Load this user's acknowledgments for the matched policies in one query.
  const policyIds = Array.from(byPolicy.keys());
  const ackRows = await db
    .select()
    .from(policyAcknowledgments)
    .where(
      and(
        eq(policyAcknowledgments.userId, user.id),
        inArray(policyAcknowledgments.policyId, policyIds),
      ),
    );
  const acksByPolicy = new Map<string, typeof ackRows[number]>();
  for (const ack of ackRows) {
    const existing = acksByPolicy.get(ack.policyId);
    if (!existing || ack.policyVersion > existing.policyVersion) {
      acksByPolicy.set(ack.policyId, ack);
    }
  }

  const result: ApplicablePolicy[] = [];
  for (const { policy, typeKey, sources } of byPolicy.values()) {
    const effectiveDates = sources
      .map((s) => s.effectiveDate)
      .filter((d): d is string => !!d)
      .sort();
    const ack = acksByPolicy.get(policy.id);
    const acknowledged = !!ack && ack.policyVersion === policy.version;
    result.push({
      policyId: policy.id,
      policyName: policy.name,
      policyTypeKey: typeKey,
      status: policy.status,
      version: policy.version,
      requiresAcknowledgment: policy.requiresAcknowledgment,
      effectiveDate: effectiveDates[0] ?? null,
      sources,
      acknowledgment: {
        required: policy.requiresAcknowledgment,
        acknowledged,
        acknowledgedAt: ack ? toIso(ack.acknowledgedAt) : null,
        acknowledgedVersion: ack ? ack.policyVersion : null,
      },
    });
  }

  result.sort((a, b) => a.policyName.localeCompare(b.policyName));
  return result;
}

export const DEFAULT_ATTENDANCE_RULES = {
  gracePeriodMinutes: 5,
  roundingRule: "nearest_15",
  roundingIntervalMinutes: 15,
  otThresholdDaily: 8,
  otThresholdWeekly: 40,
  allowedPunchSources: [...DEFAULT_ALLOWED_PUNCH_SOURCES],
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
  expirationDate: null as string | null,
  requireApproval: true,
  maxConsecutiveHours: 80,
  blackoutDates: [],
};

/**
 * Build a PtoPolicy-shaped object from a set of unified `pto` policy rules
 * (merged with DEFAULT_PTO_RULES for any missing keys). The rules JSON keys
 * intentionally mirror the legacy `pto_policies` column names, so a synthetic
 * PtoPolicy produced here is byte-identical to the legacy row it was migrated
 * from — which is what keeps every downstream accrual/balance computation
 * returning the exact same numbers after the PTO consolidation (task #397).
 */
export function buildPtoPolicyFromRules(
  policyId: string,
  policyName: string,
  rules: Record<string, any>,
): PtoPolicy {
  const merged = { ...DEFAULT_PTO_RULES, ...rules };
  return {
    id: policyId,
    name: policyName,
    description: null,
    companyId: null,
    accrualType: merged.accrualType,
    accrualHoursPerYear: merged.accrualHoursPerYear,
    yearlyCapHours: merged.yearlyCapHours ?? null,
    carryoverCapHours: merged.carryoverCapHours ?? 0,
    waitingPeriodDays: merged.waitingPeriodDays ?? 0,
    sickAccrualEnabled: merged.sickAccrualEnabled,
    sickAccrualRatePerHours: merged.sickAccrualRatePerHours,
    sickAccrualPerHoursWorked: merged.sickAccrualPerHoursWorked,
    sickYearlyCapHours: merged.sickYearlyCapHours,
    vacationAccrualPerHoursWorked: merged.vacationAccrualPerHoursWorked,
    vacationAccrualHoursPerThreshold: merged.vacationAccrualHoursPerThreshold,
    personalHoursPerYear: merged.personalHoursPerYear,
    holidayPayEnabled: merged.holidayPayEnabled,
    holidayPtoDeduction: merged.holidayPtoDeduction,
    holidayOtExclusion: merged.holidayOtExclusion,
    expirationDate: merged.expirationDate || null,
    isDefault: false,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  } as PtoPolicy;
}

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
