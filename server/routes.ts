import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage, DuplicateOpenPunchError } from "./storage";
import { badRequestFromZod, handleRouteError, mapRouteError, RouteConflictError, PayrollFinalizedError } from "./routeErrors";
import { db } from "./db";
import { payrollExports as payrollExportsTable, payrollBatchRecords as payrollBatchRecordsTable, payrollAdjustments as payrollAdjustmentsTable, biometricSupervisorOverrides as biometricSupervisorOverridesTable, userRoles as userRolesTable } from "@shared/schema";
import { requireAuth, requirePasswordChanged } from "./middleware/auth";
import { requirePermission, resolveUserPermissions } from "./middleware/rbac";
import { insertDepartmentSchema, insertTimeOffRequestSchema, insertCompanySchema, insertLocationSchema, insertLocationAddressSchema, insertEmploymentProfileSchema, insertPtoPolicySchema, insertEmployeePtoSettingsSchema, insertAttendanceExceptionSchema, insertPolicySchema, insertPolicyAssignmentSchema, insertKioskDeviceSchema, insertRoleSchema, timeOffRequests, attendanceExceptions, auditLogs, punchLogs, insertPerformanceReviewCycleSchema, insertOnboardingTemplateSchema, insertOnboardingTemplateTaskSchema, insertOffboardingTemplateSchema, insertOffboardingTemplateTaskSchema, insertOnboardingTemplateSectionSchema, insertOnboardingTemplateScopeSchema, insertOffboardingTemplateSectionSchema, insertOffboardingTemplateScopeSchema, dueRuleSchema, customFieldDefSchema, onboardingTemplateTasks, offboardingTemplateTasks, MAX_TIME_OFF_HOURS_PER_REQUEST, MIN_TIME_OFF_HOURS_APPROVED, isSaneTimeOffHours, isBalanceTrackedTimeOffType } from "@shared/schema";
import type { User, UpsertUser, PunchLog, InsertPunchLog, TimeOffRequest, Department, Location, AttendanceException, PayrollExport, OverlapPunchPair, OverlapPunchSummary } from "@shared/schema";
import { userDepartmentIds, userLocationIds } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, inArray, gte, lte } from "drizzle-orm";
import { writeAuditLog, getAuditContext } from "./services/audit";
import { writeLedgerEntry, getLedgerContext, hoursDelta } from "./services/ledger";
import { getEffectivePolicy, getApplicablePolicies, getDefaultRulesForType, DEFAULT_ATTENDANCE_RULES, DEFAULT_PTO_RULES, DEFAULT_PAYROLL_RULES } from "./policyEngine";
import { buildPayCalcPolicy, resolvePayCalcPolicy, splitDailyHours, summarizeDailyHours, computeWeeklyHours, computeGrossPay, round2, type PayCalcPolicy } from "./payrollEngine";
import { getAllowedPunchSources, isPunchSourceAllowed, punchSourceBlockedMessage } from "@shared/punchSources";
import { buildEmployeeTimesheet } from "./timesheetService";
import { getLedgerForEmployee, getLedgerForEmployees, summarizeLedger, recomputeLedger } from "./attendanceLedger";
import { validatePunchIntegrity, type ExistingPunchForValidation, type PunchValidationResult } from "./punchValidation";
import { importEmployeesFromBuffer } from "./services/employeeImport";
import {
  computeAttendanceReconciliation,
  applyAttendanceReconciliation,
  computePtoReconciliation,
  applyPtoReconciliation,
  computePayrollVerification,
  computePayrollDrift,
} from "./services/reconciliation";
import { runAlertDetection } from "./services/alerts";
import { enforceClockIn, enforceClockOut, enforcePtoAdvanceNotice, enforcePtoBlackoutDates, runAutoClockOut, createPolicyAlerts, createPolicyAlert, evaluateDayOfWeekBonuses, evaluateEarlyArrivalBonuses, roundTime } from "./services/policyEnforcement";
import { materializeOnboardingChecklist, autoCompleteDocumentTask } from "./services/onboarding";
import { materializeOffboardingChecklist, evaluateDeactivationGate } from "./services/offboarding";
import { attachPolicyContext, getPolicyRules, getResolvedPolicy } from "./middleware/policyContext";
import { runWorkflowsForTrigger } from "./workflowEngine";
import { requestCache, requestCacheInvalidator, invalidateRequestCache } from "./lib/requestCache";
import { appCache } from "./lib/cache";
import { parsePagination, MAX_PAGE_SIZE } from "./lib/pagination";
import {
  DEFAULT_PAY_PERIOD_TYPE,
  emptyCorrectionCountSummary,
  type PayPeriodType,
} from "@shared/correctionCounts";
import {
  findDayOfWeekBonusOverlaps,
  findEarlyArrivalBonusOverlaps,
  describeDays,
  DAY_NAMES,
} from "@shared/policyOverlap";

import { shouldRun } from "./lib/cooldown";
import { drainPending, enqueue } from "./services/jobs";
import { applyRoleForUser, validateConditions, isAllowedRole } from "./services/roleAssignment";
import { applyScheduleTemplate, validateTemplateDays } from "./services/scheduleTemplates";
import { autocompleteAddress, isSerpApiConfigured } from "./services/serpApi";
import { flagClockInGeofence, attachGeofenceMapToExceptions, type GeofenceMapData } from "./services/geofence";
import { resolveEmployeeTimezone, flagPunchOverlapForReconciliation, parseConflictingPunchId } from "./services/punchOverlap";
import { config } from "./config";
import { WebSocketServer, WebSocket } from "ws";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  uploadDocumentBuffer,
  streamDocument,
  deleteDocument as deleteStoredDocument,
  documentExists,
  isObjectStoragePath,
} from "./services/documentStorage";

const SUPER_ADMIN_USER_ID = "admin-dev-001";

// Hard cap for the legacy bare-array `/api/users` directory response (used by
// pickers that omit pagination params). Bounds memory/transfer so an unbounded
// fetch is impossible even without client params; large tenants should switch
// to the paginated/search response instead.
const DIRECTORY_MAX_USERS = 1000;

// Hard cap for the legacy bare-array admin attendance-exceptions response
// (callers that omit pagination params). Bounds the response even without
// client params; paginated callers should page instead.
const EXCEPTIONS_DIRECTORY_MAX = 500;

/**
 * @deprecated Manual invalidation is no longer required. The global
 * `requestCacheInvalidator()` middleware (registered in `registerRoutes`)
 * busts the entire request cache after every successful mutation, so reads are
 * always fresh. Kept as a thin delegate for the handful of historical call
 * sites; new mutation routes do NOT need to call anything.
 */
function invalidateUserCache() {
  invalidateRequestCache();
}

function validateBonusRuleOverlaps(rules: any): string | null {
  if (!rules || typeof rules !== "object") return null;
  const dowList: any[] = Array.isArray(rules.dayOfWeekBonuses) ? rules.dayOfWeekBonuses : [];
  const earlyList: any[] = Array.isArray(rules.earlyArrivalBonuses) ? rules.earlyArrivalBonuses : [];

  const dowNormalized = dowList
    .map((b, i) => ({
      id: typeof b?.id === "string" && b.id ? b.id : `__dow_${i}__`,
      dayOfWeek: typeof b?.dayOfWeek === "number" ? b.dayOfWeek : Number(b?.dayOfWeek),
    }))
    .filter((b) => Number.isInteger(b.dayOfWeek) && b.dayOfWeek >= 0 && b.dayOfWeek <= 6);
  const dowOverlaps = findDayOfWeekBonusOverlaps(dowNormalized);
  if (dowOverlaps.size > 0) {
    const days = new Set<number>();
    dowOverlaps.forEach((info) => {
      info.conflictingDays.forEach((d) => days.add(d));
    });
    const dayList = Array.from(days).sort((a, b) => a - b).map((d) => DAY_NAMES[d] || String(d)).join(", ");
    return `Day-of-week bonus rules overlap on: ${dayList}. Each day may only be covered by one rule.`;
  }

  const earlyNormalized = earlyList.map((b, i) => ({
    id: typeof b?.id === "string" && b.id ? b.id : `__early_${i}__`,
    daysOfWeek: Array.isArray(b?.daysOfWeek) ? b.daysOfWeek : null,
  }));
  const earlyOverlaps = findEarlyArrivalBonusOverlaps(earlyNormalized);
  if (earlyOverlaps.size > 0) {
    const days = new Set<number>();
    earlyOverlaps.forEach((info) => {
      info.conflictingDays.forEach((d) => days.add(d));
    });
    return `Early-arrival bonus rules overlap on: ${describeDays(Array.from(days))}. Each day may only be covered by one rule (an empty day list applies to every day).`;
  }

  return null;
}

function isSuperAdmin(req: any): boolean {
  return req.userPermissions?.has("system.super_admin") === true;
}

function hideSuperAdmin<T extends { id: string }>(users: T[], requestIsSuperAdmin: boolean): T[] {
  if (requestIsSuperAdmin) return users;
  return users.filter(u => u.id !== SUPER_ADMIN_USER_ID);
}

// Lifecycle templates may be global (companyId === null) or scoped to a single company.
// A non-super-admin actor may only access templates that are global or in their own company.
function actorCanAccessLifecycleTemplate(
  actor: { companyId: string | null },
  template: { companyId: string | null },
  requestIsSuperAdmin: boolean,
): boolean {
  if (requestIsSuperAdmin) return true;
  if (template.companyId === null) return true;
  return template.companyId === (actor.companyId ?? null);
}

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files are allowed"));
    }
  },
});

const employeeImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".xlsx", ".xls"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel (.xlsx) spreadsheets are allowed"));
    }
  },
});

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const roleSchema = z.object({
  role: z.enum(["employee", "manager", "admin"]),
});

async function checkPostExportModification(punchLogId: string, modifiedBy: string) {
  try {
    const exportedRecords = await storage.getExportedBatchRecordsByPunchLog(punchLogId);
    for (const record of exportedRecords) {
      if (record.payrollExport) {
        const existingAdjustments = await storage.getPayrollAdjustmentsByExport(record.payrollExport.id);
        const alreadyFlagged = existingAdjustments.some(
          a => a.punchLogId === punchLogId && a.status === "pending"
        );
        if (alreadyFlagged) continue;

        const punchLog = await storage.getPunchLog(punchLogId);
        await storage.createPayrollAdjustment({
          payrollExportId: record.payrollExport.id,
          employeeId: record.employeeId,
          punchLogId,
          adjustmentDate: punchLog?.workDate || new Date().toISOString().split("T")[0],
          reason: "Record modified after payroll export — review in next payroll cycle",
          status: "pending",
          reviewedBy: null,
          reviewedAt: null,
        });

        await writeLedgerEntry({
          category: "payroll",
          eventType: "payroll_reconciliation_flagged",
          employeeId: record.employeeId,
          actorUserId: modifiedBy,
          entityType: "payroll_export",
          entityId: record.payrollExport.id,
          workDate: punchLog?.workDate ?? null,
          beforeValue: null,
          afterValue: { status: "pending", punchLogId },
          context: { reason: "Record modified after payroll export", punchLogId },
          source: "system",
        });
      }
    }
  } catch (error) {
    console.error("Error checking post-export modification:", error);
  }
}

// Payroll exports are "finalized" once they've been exported or locked. A punch
// tied to a finalized batch must not be silently deleted — removing it would
// desync payroll without a paper trail (and the FK from payroll_batch_records /
// payroll_adjustments would otherwise surface a raw DB error on delete).
const FINALIZED_PAYROLL_STATUSES = ["exported", "locked"] as const;

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Returns the finalized (exported/locked) payroll exports that reference the
 * given punch — via either a batch record or an adjustment. Used to warn/block
 * managers before approving a punch_removal that would touch finalized payroll.
 */
async function findFinalizedPayrollExportsForPunch(
  punchLogId: string,
  executor: DbOrTx = db,
): Promise<PayrollExport[]> {
  const batchRefs = await executor
    .select({ exp: payrollExportsTable })
    .from(payrollBatchRecordsTable)
    .innerJoin(payrollExportsTable, eq(payrollExportsTable.id, payrollBatchRecordsTable.payrollExportId))
    .where(and(
      eq(payrollBatchRecordsTable.punchLogId, punchLogId),
      inArray(payrollExportsTable.status, [...FINALIZED_PAYROLL_STATUSES]),
    ));
  const adjustmentRefs = await executor
    .select({ exp: payrollExportsTable })
    .from(payrollAdjustmentsTable)
    .innerJoin(payrollExportsTable, eq(payrollExportsTable.id, payrollAdjustmentsTable.payrollExportId))
    .where(and(
      eq(payrollAdjustmentsTable.punchLogId, punchLogId),
      inArray(payrollExportsTable.status, [...FINALIZED_PAYROLL_STATUSES]),
    ));
  const byId = new Map<string, PayrollExport>();
  for (const r of [...batchRefs, ...adjustmentRefs]) byId.set(r.exp.id, r.exp);
  return [...byId.values()];
}

function describeFinalizedPayroll(exports: PayrollExport[]): string {
  return exports
    .map((e) => `${e.startDate} – ${e.endDate} (${e.status})`)
    .join(", ");
}

/**
 * Finalized (exported/locked) payroll exports that already include the given
 * employee AND whose date range covers `workDate`. Used to block CREATING a new
 * punch (e.g. via an approved forgotten-clock-in correction) inside a period
 * that has already been finalized — the punch-id-based guard above only catches
 * edits/deletes of punches that are already referenced by payroll, so a brand
 * new punch needs this date-coverage check instead.
 */
async function findFinalizedPayrollExportsForEmployeeDate(
  employeeId: string,
  workDate: string,
  executor: DbOrTx = db,
): Promise<PayrollExport[]> {
  const rows = await executor
    .select({ exp: payrollExportsTable })
    .from(payrollBatchRecordsTable)
    .innerJoin(payrollExportsTable, eq(payrollExportsTable.id, payrollBatchRecordsTable.payrollExportId))
    .where(and(
      eq(payrollBatchRecordsTable.employeeId, employeeId),
      inArray(payrollExportsTable.status, [...FINALIZED_PAYROLL_STATUSES]),
      lte(payrollExportsTable.startDate, workDate),
      gte(payrollExportsTable.endDate, workDate),
    ));
  const byId = new Map<string, PayrollExport>();
  for (const r of rows) byId.set(r.exp.id, r.exp);
  return [...byId.values()];
}

/** Shift a YYYY-MM-DD date string by `deltaDays` (UTC), returning YYYY-MM-DD. */
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

/**
 * Load the employee's neighbouring punches needed for overlap / duplicate-open
 * detection. Fetches a window spanning the involved work dates ± 1 day so an
 * overnight or cross-midnight shift can still be compared. Falls back to today
 * when no dates are known (live clock-in/out).
 */
async function loadPunchesForValidation(
  employeeId: string,
  candidateDates: (string | null | undefined)[],
): Promise<ExistingPunchForValidation[]> {
  const dates = candidateDates.filter((d): d is string => !!d).sort();
  if (dates.length === 0) {
    dates.push(new Date().toISOString().split("T")[0]);
  }
  const start = shiftDateStr(dates[0], -1);
  const end = shiftDateStr(dates[dates.length - 1], 1);
  const punches = await storage.getAttendanceRecords(employeeId, start, end);
  return punches.map((p) => ({ id: p.id, clockIn: p.clockIn, clockOut: p.clockOut }));
}

/**
 * Whether the attendance policy rules permit future-dated punches. Defaults to
 * false (disallow) when the key is absent — only an explicit `true` opts in.
 */
function allowFuturePunchFromRules(rules: Record<string, any> | null | undefined): boolean {
  return rules?.allowFuturePunches === true;
}

/**
 * Run the shared punch-integrity validator for one proposed punch. Gathers the
 * employee's neighbouring punches itself, then returns the structured result.
 * Routes turn `{ ok: false }` into a 400 with the human-readable reason.
 */
async function validateProposedPunch(opts: {
  employeeId: string;
  clockIn: Date | string | null | undefined;
  clockOut?: Date | string | null | undefined;
  punchId?: string | null;
  candidateDates?: (string | null | undefined)[];
  allowFuturePunch: boolean;
  now?: Date;
  timezone?: string;
  overlapPolicy?: "block" | "flag";
}): Promise<PunchValidationResult> {
  const existingPunches = await loadPunchesForValidation(
    opts.employeeId,
    opts.candidateDates ?? [],
  );
  return validatePunchIntegrity({
    punchId: opts.punchId ?? null,
    clockIn: opts.clockIn,
    clockOut: opts.clockOut,
    existingPunches,
    now: opts.now,
    allowFuturePunch: opts.allowFuturePunch,
    timezone: opts.timezone,
    overlapPolicy: opts.overlapPolicy,
  });
}

export const requireRole = (...roles: string[]): RequestHandler => {
  return async (req, res, next) => {
    const user = (req as any).authUser;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
};

function sanitizeUserForKiosk(user: User, departmentName?: string, allowedPunchSources?: string[]) {
  return {
    id: user.id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    department: departmentName || "Unassigned",
    employeeId: user.id,
    ...(allowedPunchSources ? { allowedPunchSources } : {}),
  };
}

// Resolve the allowed punch methods for a kiosk-selected employee so the tablet
// can hide its clock buttons when "kiosk" isn't permitted for them.
async function getKioskAllowedSourcesForUser(user: User): Promise<string[]> {
  const policy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
  return getAllowedPunchSources(policy?.rules || DEFAULT_ATTENDANCE_RULES);
}

function punchLogToApiResponse(record: any) {
  return {
    ...record,
    userId: record.employeeId || record.userId,
    date: record.workDate || record.date,
    totalHours: record.hoursWorked ?? record.totalHours ?? null,
  };
}

function normalizePayPeriodType(value: unknown): PayPeriodType {
  if (
    value === "weekly" ||
    value === "biweekly" ||
    value === "semimonthly" ||
    value === "monthly"
  ) {
    return value;
  }
  return DEFAULT_PAY_PERIOD_TYPE;
}

async function resolvePayPeriodTypeForUser(user: User | undefined | null): Promise<PayPeriodType> {
  if (!user) return DEFAULT_PAY_PERIOD_TYPE;
  const policy = await getEffectivePolicy(user.companyId, user.id, "payroll", user);
  const rules = policy?.rules ?? DEFAULT_PAYROLL_RULES;
  return normalizePayPeriodType((rules as any)?.payPeriodType);
}

async function buildPayPeriodTypeMap(
  employeeIds: string[],
  userMap: Map<string, User>,
): Promise<Map<string, PayPeriodType>> {
  const out = new Map<string, PayPeriodType>();
  await Promise.all(
    employeeIds.map(async (id) => {
      const u = userMap.get(id);
      out.set(id, await resolvePayPeriodTypeForUser(u));
    }),
  );
  return out;
}

async function buildDeptManagerNameMap(
  userMap: Map<string, User>,
): Promise<Map<string, string[]>> {
  const allDepartments = await storage.getAllDepartments();
  const deptManagerMap = new Map<string, string[]>();

  const roleManagersByDept = new Map<string, User[]>();
  for (const u of Array.from(userMap.values())) {
    if (u.role === "manager" && !u.deactivatedAt) {
      for (const deptId of userDepartmentIds(u)) {
        const arr = roleManagersByDept.get(deptId) || [];
        arr.push(u);
        roleManagersByDept.set(deptId, arr);
      }
    }
  }

  await Promise.all(allDepartments.map(async (dept) => {
    const linkManagers = await storage.getDepartmentManagers(dept.id);
    const seen = new Set<string>();
    const names: string[] = [];
    const addUser = (mu: User | undefined) => {
      if (!mu || seen.has(mu.id)) return;
      const name = `${mu.firstName || ""} ${mu.lastName || ""}`.trim();
      if (!name) return;
      seen.add(mu.id);
      names.push(name);
    };
    for (const m of linkManagers) addUser(userMap.get(m.userId));
    for (const mu of (roleManagersByDept.get(dept.id) || [])) addUser(mu);
    deptManagerMap.set(dept.id, names);
  }));

  return deptManagerMap;
}

/**
 * Resolve an employee's displayed department(s), location(s), and manager(s)
 * from their REAL membership (the `employee_departments` / `employee_locations`
 * join tables surfaced via `userDepartmentIds` / `userLocationIds`), NOT the
 * legacy single `users.department_id` / `users.location_id` columns which can be
 * empty or stale. Names and manager lists are unioned across all memberships
 * and de-duplicated, so a multi-department employee shows every relevant
 * department/manager instead of one stale value.
 *
 * `departmentName` / `locationName` are null when the employee genuinely has no
 * membership; callers apply their own "Unassigned" / "N/A" fallback. A
 * representative `departmentId` / `locationId` (first membership) is kept for
 * frontends that still read the single id.
 */
function resolveMembershipDisplay(
  u: { departmentIds?: string[]; departmentId?: string | null; locationIds?: string[]; locationId?: string | null } | undefined,
  deptMap: Map<string, { name?: string | null }>,
  locMap: Map<string, { name?: string | null }> | null,
  deptManagerMap: Map<string, string[]> | null,
): {
  departmentId: string | null;
  locationId: string | null;
  departmentName: string | null;
  locationName: string | null;
  managerNames: string[];
} {
  const deptIds = u ? userDepartmentIds(u) : [];
  const locIds = u ? userLocationIds(u) : [];

  const deptNames: string[] = [];
  const seenDeptName = new Set<string>();
  const managerNames: string[] = [];
  const seenManager = new Set<string>();
  for (const id of deptIds) {
    const name = deptMap.get(id)?.name;
    if (name && !seenDeptName.has(name)) {
      seenDeptName.add(name);
      deptNames.push(name);
    }
    if (deptManagerMap) {
      for (const m of (deptManagerMap.get(id) || [])) {
        if (!seenManager.has(m)) {
          seenManager.add(m);
          managerNames.push(m);
        }
      }
    }
  }

  const locNames: string[] = [];
  const seenLocName = new Set<string>();
  if (locMap) {
    for (const id of locIds) {
      const name = locMap.get(id)?.name;
      if (name && !seenLocName.has(name)) {
        seenLocName.add(name);
        locNames.push(name);
      }
    }
  }

  return {
    departmentId: deptIds[0] || null,
    locationId: locIds[0] || null,
    departmentName: deptNames.length ? deptNames.join(", ") : null,
    locationName: locNames.length ? locNames.join(", ") : null,
    managerNames,
  };
}

async function getScheduleWarning(employeeId: string, punchType: "clock_in" | "clock_out"): Promise<string | null> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const schedule = await storage.getEmployeeScheduleByDay(employeeId, dayOfWeek);
  if (!schedule) return null;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = schedule.startTime.split(":").map(Number);
  const [endH, endM] = schedule.endTime.split(":").map(Number);
  const scheduleStart = startH * 60 + startM;
  const scheduleEnd = endH * 60 + endM;

  if (punchType === "clock_in") {
    const diff = currentMinutes - scheduleStart;
    if (diff < 0) {
      const mins = Math.abs(diff);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `You are ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} early` : `You are ${m} minute${m !== 1 ? "s" : ""} early`;
    } else if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return h > 0 ? `You are ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} late` : `You are ${m} minute${m !== 1 ? "s" : ""} late`;
    }
  } else {
    const diff = currentMinutes - scheduleEnd;
    if (diff < 0) {
      const mins = Math.abs(diff);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `You are leaving ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} early` : `You are leaving ${m} minute${m !== 1 ? "s" : ""} early`;
    } else if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return h > 0 ? `You stayed ${h} hour${h > 1 ? "s" : ""}${m > 0 ? ` and ${m} minute${m !== 1 ? "s" : ""}` : ""} past your shift` : `You stayed ${m} minute${m !== 1 ? "s" : ""} past your shift`;
    }
  }
  return null;
}

const pinLookupSchema = z.object({
  pin: z.string().min(4).max(6),
});

const kioskPunchSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["clock_in", "clock_out"]),
  // Task #418: optional device coordinates captured at the kiosk for geofencing.
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Keep the server read cache fresh automatically: any successful mutation
  // (POST/PUT/PATCH/DELETE) clears the request cache before its response
  // flushes, so reads never serve stale data. Mutation routes do NOT need to
  // invalidate by hand — see `requestCacheInvalidator`.
  app.use(requestCacheInvalidator());

  const PASSWORD_CHANGE_EXEMPT_PATHS = ["/api/auth", "/api/users/change-password"];
  app.use((req, res, next) => {
    // Only ever gate API calls. Never block non-API routes (the SPA HTML
    // document and its assets) — otherwise a user flagged forcePasswordChange
    // gets a raw 403 JSON when loading the page and can never reach the
    // change-password screen that would clear the flag.
    if (!req.path.startsWith("/api")) {
      return next();
    }
    if (PASSWORD_CHANGE_EXEMPT_PATHS.some(p => req.path.startsWith(p))) {
      return next();
    }
    requirePasswordChanged(req, res, next);
  });
  app.get("/api/auth/permissions", requireAuth, async (req, res) => {
    const user = (req as any).authUser as User | undefined;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const perms = await resolveUserPermissions(user.id);
    res.json({ permissions: Array.from(perms) });
  });

  app.get("/api/users", requireAuth, requirePermission("users.view"), requestCache({ scope: "user" }), async (req, res) => {
    const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 1000 });
    const excludeUserIds = isSuperAdmin(req) ? [] : [SUPER_ADMIN_USER_ID];

    // Attach role-rule provenance: which active rule (if any) matches this
    // user. UI uses this to show "Set by rule" only when an actual rule
    // matches, instead of inferring from the absence of a manual override.
    const [activeRules, allProfiles] = await Promise.all([
      storage.getActiveRoleAssignmentRules(),
      storage.getAllEmploymentProfiles(),
    ]);
    const profileByUser = new Map(allProfiles.map(p => [p.userId, p]));
    const { evaluateRoleForUser } = await import("./services/roleAssignment");
    const enrich = (list: User[]) => list.map(u => {
      const match = evaluateRoleForUser(u, profileByUser.get(u.id), activeRules);
      return {
        ...u,
        assignedByRule: match ? { id: match.rule.id, name: match.rule.name } : null,
      };
    });

    if (pagination.paginated) {
      const { rows, total } = await storage.getUsersPage({
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        departmentId: typeof req.query.departmentId === "string" ? req.query.departmentId : undefined,
        companyId: typeof req.query.companyId === "string" ? req.query.companyId : undefined,
        taxClass: typeof req.query.taxClass === "string" ? req.query.taxClass : undefined,
        certStatus: typeof req.query.certStatus === "string" ? req.query.certStatus : undefined,
        excludeUserIds,
        limit: pagination.limit,
        offset: pagination.offset,
      });
      return res.json({ data: enrich(rows), total, limit: pagination.limit, offset: pagination.offset });
    }

    // Legacy directory response (pickers that omit pagination params): bounded
    // array, capped so an unbounded fetch is impossible.
    const { rows } = await storage.getUsersPage({
      excludeUserIds,
      limit: DIRECTORY_MAX_USERS,
      offset: 0,
    });
    res.json(enrich(rows));
  });

  app.patch("/api/users/:id/role", requireAuth, requirePermission("users.edit"), async (req, res) => {
    if (String(req.params.id) === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
    }
    const id = String(req.params.id) as string;
    const before = await storage.getUser(id);
    if (!before) return res.status(404).json({ message: "User not found" });
    const user = await storage.updateUser(id, {
      role: parsed.data.role,
      roleManuallyOverriddenAt: new Date(),
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    const actor = (req as any).authUser as User | undefined;
    if (actor && before.role !== parsed.data.role) {
      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "user",
        targetId: id,
        action: "user.role_change",
        oldValue: { role: before.role },
        newValue: { role: parsed.data.role },
        context: { source: "manual" },
      });
    }
    invalidateUserCache();
    res.json(user);
  });

  app.post("/api/users/:id/clear-role-override", requireAuth, requirePermission("users.edit"), async (req, res) => {
    if (String(req.params.id) === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const id = String(req.params.id) as string;
    const existing = await storage.getUser(id);
    if (!existing) return res.status(404).json({ message: "User not found" });
    const previouslyOverridden = existing.roleManuallyOverriddenAt;
    await storage.updateUser(id, { roleManuallyOverriddenAt: null });
    const actor = (req as any).authUser as User;
    const auditCtx = getAuditContext(req);
    if (previouslyOverridden) {
      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "user",
        targetId: id,
        action: "user.role_override_cleared",
        oldValue: { manualOverride: true, role: existing.role },
        newValue: { manualOverride: false, role: existing.role },
        context: getAuditContext(req),
      });
    }
    // Manually-assigned RBAC roles ARE the override: drop them so permissions
    // fall back to the rules engine + legacy tier mapping. Each removal is
    // audited. Super-Admin assignments invisible to a non–super-admin actor are
    // preserved so they can't be silently stripped.
    const isSA = isSuperAdmin(req);
    const currentRoles = await storage.getUserRoles(id);
    for (const ur of currentRoles) {
      if (!isSA) {
        const keys = (await storage.getRolePermissions(ur.roleId)).map((p) => p.key);
        if (keys.includes("system.super_admin")) continue;
      }
      await storage.removeUserRole(id, ur.roleId);
      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "user",
        targetId: id,
        action: "user.role_removed",
        oldValue: { roleId: ur.roleId, roleName: ur.role?.name },
        context: { source: "override_cleared" },
        ...auditCtx,
      });
    }
    const result = await applyRoleForUser(id, { actorUserId: actor.id, reason: "manual override cleared", force: true });
    const user = await storage.getUser(id);
    invalidateUserCache();
    res.json({ user, result });
  });

  // --- RBAC multi-role assignment for an employee (Employee profile Basic Info) ---
  // Roles the acting user is allowed to assign to a target employee. Gated by the
  // SAME `users.edit` permission used to change a user's role. Excludes the Super
  // Admin role for non–super-admins and any role carrying a permission the actor
  // does not personally hold (no privilege escalation).
  app.get("/api/users/:id/assignable-roles", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    try {
      const id = String(req.params.id);
      if (id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
        return res.status(404).json({ message: "User not found" });
      }
      const isSA: boolean = req.userPermissions?.has("system.super_admin") ?? false;
      const actorPerms: Set<string> = req.userPermissions ?? new Set<string>();
      const allRoles = await storage.getAllRoles();
      const result: Array<{ id: string; name: string; description: string | null; isSystem: boolean; permissionCount: number }> = [];
      for (const role of allRoles) {
        if (!role.isActive) continue;
        const keys = (await storage.getRolePermissions(role.id)).map((p) => p.key);
        if (!isSA && keys.includes("system.super_admin")) continue;
        if (!isSA && !keys.every((k) => actorPerms.has(k))) continue;
        result.push({ id: role.id, name: role.name, description: role.description, isSystem: role.isSystem, permissionCount: keys.length });
      }
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, "Failed to fetch assignable roles");
    }
  });

  // Currently-assigned RBAC roles for a target user. Super-Admin role rows are
  // hidden from non–super-admins (consistent with /api/roles).
  app.get("/api/users/:id/roles", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    try {
      const id = String(req.params.id);
      if (id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
        return res.status(404).json({ message: "User not found" });
      }
      const isSA: boolean = req.userPermissions?.has("system.super_admin") ?? false;
      const assigned = await storage.getUserRoles(id);
      const rows: Array<{ id: string; name: string }> = [];
      for (const ur of assigned) {
        if (!ur.role) continue;
        if (!isSA) {
          const keys = (await storage.getRolePermissions(ur.roleId)).map((p) => p.key);
          if (keys.includes("system.super_admin")) continue;
        }
        rows.push({ id: ur.roleId, name: ur.role.name });
      }
      res.json(rows);
    } catch (error) {
      handleRouteError(res, error, "Failed to fetch user roles");
    }
  });

  const setUserRolesSchema = z.object({ roleIds: z.array(z.string()).max(50) });

  // Replace a user's assigned RBAC roles with a provided set. Re-validates every
  // role id, re-checks the Super-Admin and privilege-escalation guards
  // server-side, keeps the flat `users.role` tier in sync (highest-privilege
  // assigned role), marks this as a manual override, and audits each add/remove.
  app.put("/api/users/:id/roles", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    try {
      const id = String(req.params.id);
      if (id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
        return res.status(404).json({ message: "User not found" });
      }
      const parsed = setUserRolesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid roleIds", errors: parsed.error.flatten() });
      }
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ message: "User not found" });

      const isSA: boolean = req.userPermissions?.has("system.super_admin") ?? false;
      const actorPerms: Set<string> = req.userPermissions ?? new Set<string>();
      const requestedIds = Array.from(new Set(parsed.data.roleIds));

      const current = await storage.getUserRoles(id);
      const currentIds = new Set(current.map((c) => c.roleId));

      // Never silently drop a Super-Admin assignment a non–super-admin can't see.
      const protectedIds = new Set<string>();
      if (!isSA) {
        for (const c of current) {
          const keys = (await storage.getRolePermissions(c.roleId)).map((p) => p.key);
          if (keys.includes("system.super_admin")) protectedIds.add(c.roleId);
        }
      }

      const desiredIds = new Set<string>([...requestedIds, ...protectedIds]);
      const toAdd = [...desiredIds].filter((rid) => !currentIds.has(rid));
      const toRemove = [...currentIds].filter((rid) => !desiredIds.has(rid));

      // Guards apply only to NEWLY-added roles: keeping an already-assigned role
      // is not privilege escalation, so it must never block an unrelated edit.
      const addedRoleNames = new Map<string, string>();
      for (const roleId of toAdd) {
        const role = await storage.getRole(roleId);
        if (!role) return res.status(400).json({ message: `Unknown role: ${roleId}` });
        if (!role.isActive) return res.status(400).json({ message: `Role is inactive: ${role.name}` });
        const keys = (await storage.getRolePermissions(roleId)).map((p) => p.key);
        if (!isSA && keys.includes("system.super_admin")) {
          return res.status(403).json({ message: "Cannot assign the Super Admin role" });
        }
        if (!isSA && !keys.every((k) => actorPerms.has(k))) {
          return res.status(403).json({ message: `Cannot assign role "${role.name}": it grants permissions you do not hold` });
        }
        addedRoleNames.set(roleId, role.name);
      }

      for (const rid of toAdd) await storage.assignUserRole(id, rid, target.companyId ?? undefined);
      for (const rid of toRemove) await storage.removeUserRole(id, rid);

      // Derive the flat `users.role` tier deterministically from the FINAL set of
      // assigned roles (highest privilege wins). When no roles remain, drop to the
      // `employee` baseline — never retain the prior tier, or a removed admin/manager
      // would keep elevated access in legacy `requireRole(...)` gates.
      const { tierFromPermissionKeys, highestTier } = await import("./services/roleAssignment");
      const finalAssigned = await storage.getUserRoles(id);
      let newTier: "admin" | "manager" | "employee" = "employee";
      if (finalAssigned.length > 0) {
        const tiers = [] as Array<"admin" | "manager" | "employee">;
        for (const a of finalAssigned) {
          const keys = (await storage.getRolePermissions(a.roleId)).map((p) => p.key);
          tiers.push(tierFromPermissionKeys(keys));
        }
        newTier = highestTier(tiers);
      }
      await storage.updateUser(id, { role: newTier, roleManuallyOverriddenAt: new Date() });

      const actor = req.authUser as User;
      const auditCtx = getAuditContext(req);
      for (const rid of toAdd) {
        await writeAuditLog({
          actorUserId: actor.id,
          targetType: "user",
          targetId: id,
          action: "user.role_assigned",
          newValue: { roleId: rid, roleName: addedRoleNames.get(rid) },
          context: { source: "manual" },
          ...auditCtx,
        });
      }
      for (const rid of toRemove) {
        const r = current.find((x) => x.roleId === rid);
        await writeAuditLog({
          actorUserId: actor.id,
          targetType: "user",
          targetId: id,
          action: "user.role_removed",
          oldValue: { roleId: rid, roleName: r?.role?.name },
          context: { source: "manual" },
          ...auditCtx,
        });
      }

      invalidateUserCache();
      const updated = await storage.getUser(id);
      res.json({ user: updated, roleIds: finalAssigned.map((a) => a.roleId) });
    } catch (error) {
      handleRouteError(res, error, "Failed to update user roles");
    }
  });

  const createUserSchema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.string().email()),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.enum(["employee", "manager", "admin"]).default("employee"),
    companyId: z.string().optional().nullable(),
    locationId: z.string().optional().nullable(),
    departmentId: z.string().optional().nullable(),
    // Many-to-many assignments. When provided, these supersede the single
    // departmentId/locationId (which are kept populated as a compat shim).
    departmentIds: z.array(z.string()).optional(),
    locationIds: z.array(z.string()).optional(),
    employmentType: z.string().optional(),
    taxClassification: z.enum(["W-2", "1099"]).optional(),
    hireDate: z.string().optional(),
    payType: z.string().optional(),
    hourlyRate: z.number().optional(),
    weeklySalary: z.number().optional(),
    dailySalary: z.number().optional(),
    onboardingTemplateId: z.string().optional().nullable(),
    skipOnboarding: z.boolean().optional(),
  });

  app.post("/api/users", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid user data", errors: parsed.error.flatten() });
    }

    const existing = await storage.getUserByEmail(parsed.data.email);
    if (existing) {
      return res.status(409).json({
        message: "A user with this email already exists",
        code: "EMAIL_ALREADY_EXISTS",
        field: "email",
      });
    }

    if (parsed.data.companyId) {
      if (parsed.data.locationId) {
        const loc = await storage.getLocation(parsed.data.locationId);
        if (!loc) {
          return res.status(400).json({ message: "Location does not belong to the selected company" });
        }
        const locCompanies = new Set([
          ...(loc.companyId ? [loc.companyId] : []),
          ...(await storage.getLocationCompanyIds(loc.id)),
        ]);
        if (!locCompanies.has(parsed.data.companyId)) {
          return res.status(400).json({ message: "Location does not belong to the selected company" });
        }
      }
      if (parsed.data.departmentId) {
        const dept = await storage.getDepartment(parsed.data.departmentId);
        if (!dept || (dept.companyId && dept.companyId !== parsed.data.companyId)) {
          return res.status(400).json({ message: "Department does not belong to the selected company" });
        }
      }
    }

    // Always create an employment profile so every new hire has a tax
    // classification on record (defaults to W-2). Reports and payroll filters
    // depend on this field being present.
    const profilePayType = parsed.data.payType || "hourly";
    if (profilePayType === "hourly" && !(parsed.data.hourlyRate && parsed.data.hourlyRate > 0)) {
      return res.status(400).json({ message: "Hourly pay type requires a positive Hourly Rate." });
    }
    if (profilePayType === "daily" && !(parsed.data.dailySalary && parsed.data.dailySalary > 0)) {
      return res.status(400).json({ message: "Daily pay type requires a positive Daily Rate." });
    }
    if (profilePayType === "salary" && !(parsed.data.weeklySalary && parsed.data.weeklySalary > 0)) {
      return res.status(400).json({ message: "Salary pay type requires a positive Weekly Salary." });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const newUser = await storage.createUser({
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role,
      password: hashedPassword,
      passwordHash: hashedPassword,
      forcePasswordChange: true,
      companyId: parsed.data.companyId || null,
      locationId: parsed.data.locationId || null,
      departmentId: parsed.data.departmentId || null,
    });

    // Persist many-to-many department/location memberships. When the arrays are
    // provided they win; otherwise fall back to the single value just written.
    const newDeptIds = parsed.data.departmentIds ?? (parsed.data.departmentId ? [parsed.data.departmentId] : []);
    const newLocIds = parsed.data.locationIds ?? (parsed.data.locationId ? [parsed.data.locationId] : []);
    await storage.setUserDepartmentIds(newUser.id, newDeptIds);
    await storage.setUserLocationIds(newUser.id, newLocIds);

    await storage.createEmploymentProfile({
      userId: newUser.id,
      employmentType: parsed.data.employmentType || "full_time",
      taxClassification: parsed.data.taxClassification || "W-2",
      payType: profilePayType,
      hourlyRate: parsed.data.hourlyRate || null,
      weeklySalary: parsed.data.weeklySalary || null,
      dailySalary: parsed.data.dailySalary || null,
      hireDate: parsed.data.hireDate || null,
      overtimeEligible: profilePayType === "hourly",
      holidayPayEnabled: false,
      voluntaryPayEnabled: false,
    });

    try {
      const actor = (req as any).authUser as User | undefined;
      await applyRoleForUser(newUser.id, {
        actorUserId: actor?.id || "system",
        reason: "user.create",
      });
    } catch (err) {
      console.error("applyRoleForUser failed on user create:", err);
    }

    invalidateUserCache();

    if (!parsed.data.skipOnboarding) {
      try {
        const actorId = (req as any).authUser?.id || SUPER_ADMIN_USER_ID;
        const auditCtx = getAuditContext(req);
        await materializeOnboardingChecklist(newUser, {
          templateId: parsed.data.onboardingTemplateId ?? null,
          hireDate: parsed.data.hireDate ?? null,
          startedBy: actorId,
          context: { ip: auditCtx.ipAddress ?? null, userAgent: auditCtx.userAgent ?? null },
        });
      } catch (err) {
        console.error("Failed to materialize onboarding checklist:", err);
        try {
          await createPolicyAlert({
            type: "onboarding_materialization_failed",
            severity: "high",
            employeeId: newUser.id,
            message: `Failed to start onboarding for ${newUser.firstName ?? ""} ${newUser.lastName ?? ""}`.trim(),
            details: { error: (err as Error).message },
          });
        } catch {}
      }
    }

    const refreshed = await storage.getUser(newUser.id);
    const { password: _, passwordHash: _ph, ...safeUser } = refreshed || newUser;
    res.status(201).json({ ...safeUser, temporaryPassword: tempPassword });
  });

  const updateUserSchema = z.object({
    companyId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    // Many-to-many memberships; when provided they replace the full set.
    departmentIds: z.array(z.string()).optional(),
    locationIds: z.array(z.string()).optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.string().email())
      .optional(),
  });

  const bulkAssignDivisionSchema = z.object({
    userIds: z.array(z.string().min(1)).min(1).max(500),
    companyId: z.string().min(1),
    keepCompatible: z.boolean().optional().default(false),
  });

  app.post("/api/users/bulk-assign-division", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = bulkAssignDivisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequestFromZod(res, parsed, "Invalid bulk-assign request");
    }
    const { companyId, keepCompatible } = parsed.data;
    const userIds = Array.from(new Set(parsed.data.userIds));
    const requesterIsSuper = isSuperAdmin(req);
    const actor = (req as any).authUser as User;
    const auditCtx = getAuditContext(req);

    const division = await storage.getCompany(companyId);
    if (!division) return res.status(400).json({ message: "Division not found" });

    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const uid of userIds) {
      if (uid === SUPER_ADMIN_USER_ID && !requesterIsSuper) {
        skipped.push({ id: uid, reason: "not_found" });
        continue;
      }
      const existing = await storage.getUser(uid);
      if (!existing) {
        skipped.push({ id: uid, reason: "not_found" });
        continue;
      }

      let nextLocationId: string | null = null;
      let nextDepartmentId: string | null = null;

      if (keepCompatible) {
        if (existing.locationId) {
          const loc = await storage.getLocation(existing.locationId);
          if (loc) {
            const locCompanyIds = await storage.getLocationCompanyIds(loc.id);
            const merged = new Set([
              ...(loc.companyId ? [loc.companyId] : []),
              ...locCompanyIds,
            ]);
            if (merged.has(companyId)) nextLocationId = existing.locationId;
          }
        }
        if (existing.departmentId) {
          const dept = await storage.getDepartment(existing.departmentId);
          if (dept && (!dept.companyId || dept.companyId === companyId)) nextDepartmentId = existing.departmentId;
        }
      }

      const result = await storage.updateUser(uid, {
        companyId,
        locationId: nextLocationId,
        departmentId: nextDepartmentId,
      });
      if (!result) {
        skipped.push({ id: uid, reason: "update_failed" });
        continue;
      }

      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "user",
        targetId: uid,
        action: "user.bulk_assign_division",
        oldValue: {
          companyId: existing.companyId,
          locationId: existing.locationId,
          departmentId: existing.departmentId,
        },
        newValue: {
          companyId,
          locationId: nextLocationId,
          departmentId: nextDepartmentId,
        },
        context: { keepCompatible, divisionName: division.name },
        ...auditCtx,
      });

      updated.push(uid);
    }

    res.json({ updatedCount: updated.length, updatedIds: updated, skipped });
  });

  const bulkDeleteUsersSchema = z.object({
    userIds: z.array(z.string().min(1)).min(1).max(200),
  });

  app.post("/api/users/bulk-delete", requireAuth, requirePermission("users.delete"), async (req, res) => {
    const parsed = bulkDeleteUsersSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequestFromZod(res, parsed, "Invalid bulk-delete request");
    }
    const actor = (req as any).authUser as User;
    const auditCtx = getAuditContext(req);
    const requesterIsSuper = isSuperAdmin(req);
    const userIds = Array.from(new Set(parsed.data.userIds));

    const deleted: string[] = [];
    const skipped: { userId: string; reason: string }[] = [];

    for (const uid of userIds) {
      if (uid === actor.id) {
        skipped.push({ userId: uid, reason: "cannot_delete_self" });
        continue;
      }
      if (uid === SUPER_ADMIN_USER_ID && !requesterIsSuper) {
        skipped.push({ userId: uid, reason: "not_found" });
        continue;
      }
      const existing = await storage.getUser(uid);
      if (!existing) {
        skipped.push({ userId: uid, reason: "not_found" });
        continue;
      }
      try {
        await storage.deleteUser(uid);
      } catch (err: any) {
        const code = err?.code || err?.cause?.code;
        const reason = code === "23503" ? "has_dependent_records" : "delete_failed";
        console.error(`[bulk-delete] failed to delete user ${uid}:`, err?.message || err);
        skipped.push({ userId: uid, reason });
        continue;
      }

      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "user",
        targetId: uid,
        action: "user.delete",
        oldValue: existing as unknown as Record<string, unknown>,
        newValue: null,
        context: { bulk: true },
        ...auditCtx,
      });

      deleted.push(uid);
    }

    if (deleted.length > 0) invalidateUserCache();
    res.json({ deleted, skipped });
  });

  // Bulk-import employees from an uploaded .xlsx spreadsheet. Admin-only.
  // Idempotent: existing employees (matched on stored employee number) are
  // updated, new ones are created. Runs against whichever database the app is
  // connected to (so on the published site it loads production).
  app.post(
    "/api/users/import",
    requireAuth,
    requireRole("admin"),
    requirePermission("users.edit"),
    (req: any, res, next) => {
      employeeImportUpload.single("file")(req, res, (err: any) => {
        if (err) {
          return res
            .status(400)
            .json({ message: err.message || "Invalid upload" });
        }
        next();
      });
    },
    async (req: any, res) => {
      if (!req.file?.buffer) {
        return res.status(400).json({ message: "No spreadsheet file uploaded" });
      }
      const actor = (req as any).authUser as User;
      const auditCtx = getAuditContext(req);
      try {
        const summary = await importEmployeesFromBuffer(req.file.buffer);
        invalidateUserCache();
        await writeAuditLog({
          actorUserId: actor.id,
          targetType: "company",
          targetId: summary.companyId,
          action: "user.bulk_import",
          oldValue: null,
          newValue: {
            created: summary.created,
            updated: summary.updated,
            skipped: summary.skipped.length,
            company: summary.company,
          },
          context: { fileName: req.file.originalname },
          ...auditCtx,
        });
        res.json(summary);
      } catch (err) {
        handleRouteError(res, err, "Failed to import employees");
      }
    },
  );

  app.patch("/api/users/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    if (String(req.params.id) === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
    }
    const existing = await storage.getUser(String(req.params.id));
    if (!existing) return res.status(404).json({ message: "User not found" });

    if (parsed.data.email !== undefined && parsed.data.email !== existing.email) {
      const dup = await storage.getUserByEmail(parsed.data.email);
      if (dup && dup.id !== existing.id) {
        return res.status(409).json({
          message: "A user with this email already exists",
          code: "EMAIL_ALREADY_EXISTS",
          field: "email",
        });
      }
    }

    // Resolve the effective membership sets. Arrays (when provided) take
    // precedence; otherwise fall back to the single field, then to the existing
    // hydrated membership. The legacy single column tracks the first element.
    const deptIdsProvided = parsed.data.departmentIds !== undefined;
    const locIdsProvided = parsed.data.locationIds !== undefined;
    const nextDeptIds = deptIdsProvided
      ? Array.from(new Set(parsed.data.departmentIds!.filter(Boolean)))
      : parsed.data.departmentId !== undefined
        ? (parsed.data.departmentId ? [parsed.data.departmentId] : [])
        : userDepartmentIds(existing);
    const nextLocIds = locIdsProvided
      ? Array.from(new Set(parsed.data.locationIds!.filter(Boolean)))
      : parsed.data.locationId !== undefined
        ? (parsed.data.locationId ? [parsed.data.locationId] : [])
        : userLocationIds(existing);

    const next = {
      companyId: parsed.data.companyId !== undefined ? parsed.data.companyId : existing.companyId,
      locationId: nextLocIds[0] ?? null,
      departmentId: nextDeptIds[0] ?? null,
    };

    if (next.companyId) {
      for (const locId of nextLocIds) {
        const loc = await storage.getLocation(locId);
        if (!loc) {
          return res.status(400).json({ message: "Location does not belong to the selected company" });
        }
        const locCompanies = new Set([
          ...(loc.companyId ? [loc.companyId] : []),
          ...(await storage.getLocationCompanyIds(loc.id)),
        ]);
        if (!locCompanies.has(next.companyId)) {
          return res.status(400).json({ message: "Location does not belong to the selected company" });
        }
      }
      for (const deptId of nextDeptIds) {
        const dept = await storage.getDepartment(deptId);
        if (!dept || (dept.companyId && dept.companyId !== next.companyId)) {
          return res.status(400).json({ message: "Department does not belong to the selected company" });
        }
      }
    } else {
      if (nextLocIds.length > 0 || nextDeptIds.length > 0) {
        return res.status(400).json({ message: "Cannot assign location or department without a company" });
      }
    }

    const identityPatch: Partial<UpsertUser> = {};
    if (parsed.data.firstName !== undefined) identityPatch.firstName = parsed.data.firstName;
    if (parsed.data.lastName !== undefined) identityPatch.lastName = parsed.data.lastName;
    if (parsed.data.email !== undefined) identityPatch.email = parsed.data.email;

    const updated = await storage.updateUser(String(req.params.id), {
      companyId: next.companyId,
      locationId: next.locationId,
      departmentId: next.departmentId,
      ...identityPatch,
    });
    if (!updated) return res.status(404).json({ message: "User not found" });

    // Sync the many-to-many membership whenever department/location was touched
    // (single field or array). Keeps the join tables authoritative.
    if (deptIdsProvided || parsed.data.departmentId !== undefined || parsed.data.companyId !== undefined) {
      await storage.setUserDepartmentIds(String(req.params.id), nextDeptIds);
    }
    if (locIdsProvided || parsed.data.locationId !== undefined || parsed.data.companyId !== undefined) {
      await storage.setUserLocationIds(String(req.params.id), nextLocIds);
    }

    try {
      const actor = (req as any).authUser as User | undefined;
      const identityChanges: Record<string, { from: unknown; to: unknown }> = {};
      if (identityPatch.firstName !== undefined && identityPatch.firstName !== existing.firstName) {
        identityChanges.firstName = { from: existing.firstName, to: identityPatch.firstName };
      }
      if (identityPatch.lastName !== undefined && identityPatch.lastName !== existing.lastName) {
        identityChanges.lastName = { from: existing.lastName, to: identityPatch.lastName };
      }
      if (identityPatch.email !== undefined && identityPatch.email !== existing.email) {
        identityChanges.email = { from: existing.email, to: identityPatch.email };
      }
      if (Object.keys(identityChanges).length > 0) {
        await writeAuditLog({
          actorUserId: actor?.id || "system",
          targetType: "user",
          targetId: String(req.params.id),
          action: "user.identity_change",
          oldValue: Object.fromEntries(
            Object.entries(identityChanges).map(([k, v]) => [k, v.from]),
          ),
          newValue: Object.fromEntries(
            Object.entries(identityChanges).map(([k, v]) => [k, v.to]),
          ),
          ...getAuditContext(req),
        });
      }
    } catch (err) {
      console.error("Failed to write identity-change audit log:", err);
    }

    try {
      const actor = (req as any).authUser as User | undefined;
      await applyRoleForUser(String(req.params.id), {
        actorUserId: actor?.id || "system",
        reason: "user.update",
      });
    } catch (err) {
      console.error("applyRoleForUser failed on user update:", err);
    }

    invalidateUserCache();
    const refreshed = await storage.getUser(String(req.params.id));
    const { password: _p, passwordHash: _ph, ...safe } = refreshed || updated;
    res.json(safe);
  });

  app.post("/api/users/:id/reset-password", requireAuth, requirePermission("users.edit"), async (req, res) => {
    if (String(req.params.id) === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = await storage.getUser(String(req.params.id));
    if (!user) return res.status(404).json({ message: "User not found" });

    const mode = req.body?.mode === "emailLink" ? "emailLink" : "tempPassword";
    const actor = (req as any).authUser as User | undefined;
    const auditCtx = getAuditContext(req);

    if (mode === "emailLink") {
      const { getEmailServiceStatus, buildResetUrl, sendPasswordResetEmail } =
        await import("./services/email");
      const { createResetTokenForUser, isUserEligibleForReset } =
        await import("./services/passwordReset");

      if (!user.email) {
        return res.status(400).json({
          message: "This user has no email address on file.",
          code: "NO_EMAIL",
        });
      }
      if (!isUserEligibleForReset(user)) {
        return res.status(400).json({
          message: "This user is deactivated and cannot receive a reset link.",
          code: "USER_INELIGIBLE",
        });
      }
      const status = getEmailServiceStatus();
      if (!status.configured) {
        return res.status(503).json({
          message: "Email service not configured",
          code: "EMAIL_NOT_CONFIGURED",
        });
      }

      const ip = (auditCtx.ipAddress as string | undefined) ?? null;
      const { token, record } = await createResetTokenForUser(user.id, ip);
      // Reset URLs come from the configured trusted origin only — never
      // request headers — to avoid host-header poisoning attacks against
      // password recovery.
      const resetUrl = buildResetUrl(token);

      await writeAuditLog({
        actorUserId: actor?.id || user.id,
        targetType: "user",
        targetId: user.id,
        action: "password_reset.requested",
        newValue: { tokenId: record.id, expiresAt: record.expiresAt, source: "admin_email" },
        ...auditCtx,
      });

      if (!resetUrl) {
        await writeAuditLog({
          actorUserId: actor?.id || user.id,
          targetType: "user",
          targetId: user.id,
          action: "password_reset.email_failed",
          newValue: { tokenId: record.id, source: "admin_email", error: "APP_URL not configured" },
          ...auditCtx,
        });
        return res.status(503).json({
          message: "APP_URL is not configured — cannot send a safe reset link.",
          code: "APP_URL_NOT_CONFIGURED",
        });
      }

      const result = await sendPasswordResetEmail(user, resetUrl);
      await writeAuditLog({
        actorUserId: actor?.id || user.id,
        targetType: "user",
        targetId: user.id,
        action: result.ok ? "password_reset.email_sent" : "password_reset.email_failed",
        newValue: {
          tokenId: record.id,
          provider: result.provider,
          source: "admin_email",
          error: result.ok ? undefined : result.error,
        },
        ...auditCtx,
      });

      if (!result.ok) {
        return res.status(502).json({
          message: `Could not send reset email: ${result.error || "unknown error"}`,
          code: "EMAIL_SEND_FAILED",
        });
      }
      return res.json({ mode, sentTo: user.email });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await storage.updateUser(user.id, {
      password: hashedPassword,
      passwordHash: hashedPassword,
      forcePasswordChange: true,
    });

    await writeAuditLog({
      actorUserId: actor?.id || user.id,
      targetType: "user",
      targetId: user.id,
      action: "password_reset.temp_password_issued",
      newValue: { source: "admin_temp" },
      ...auditCtx,
    });

    res.json({ mode, temporaryPassword: tempPassword });
  });

  app.post("/api/users/change-password", requireAuth, async (req, res) => {
    const user = (req as any).authUser as User;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const fullUser = await storage.getUser(user.id);
    if (!fullUser) return res.status(404).json({ message: "User not found" });

    if (!fullUser.forcePasswordChange) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Current password is required" });
      }
      const hashToCheck = fullUser.passwordHash || fullUser.password;
      if (hashToCheck) {
        const valid = await bcrypt.compare(currentPassword, hashToCheck);
        if (!valid) {
          return res.status(401).json({ message: "Current password is incorrect" });
        }
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await storage.updateUser(user.id, {
      password: hashedPassword,
      passwordHash: hashedPassword,
      forcePasswordChange: false,
    });

    res.json({ message: "Password changed successfully" });
  });

  const ALLOWED_DOCUMENT_TYPES = ["w9", "i9", "direct_deposit", "emergency_contact", "handbook_ack"];

  app.get("/api/users/:id/documents", requireAuth, requirePermission("users.view"), async (req, res) => {
    const docs = await storage.getDocumentsByEmployee(String(req.params.id));
    res.json(docs);
  });

  app.post("/api/users/:id/documents", requireAuth, requirePermission("users.edit"), documentUpload.single("file"), async (req, res) => {
    const employee = await storage.getUser(String(req.params.id));
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const documentType = req.body.documentType;
    if (!documentType || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ message: "Invalid or missing document type" });
    }

    const adminUser = (req as any).authUser as User;

    let storagePath: string | null = null;
    try {
      const uploaded = await uploadDocumentBuffer(file.buffer, file.originalname, file.mimetype);
      storagePath = uploaded.storagePath;

      const doc = await storage.createDocument({
        employeeId: String(req.params.id),
        documentType,
        fileName: file.originalname,
        filePath: uploaded.storagePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        status: "uploaded",
        uploadedBy: adminUser.id,
      });

      try {
        const { resolveMissingDocumentAlertsFor } = await import("./services/lifecycleAlerts");
        await resolveMissingDocumentAlertsFor(String(req.params.id), documentType, adminUser.id);
      } catch (err) {
        console.error("Failed to resolve missing-document alerts after upload:", err);
      }
      try {
        await autoCompleteDocumentTask(String(req.params.id), documentType, doc.id, adminUser.id);
      } catch (e) {
        console.error("autoCompleteDocumentTask failed:", e);
      }

      res.status(201).json(doc);
    } catch (error) {
      console.error("Failed to save document:", error);
      if (storagePath) {
        try { await deleteStoredDocument(storagePath); } catch (cleanupErr) {
          console.warn("Failed to clean up stored document after error:", cleanupErr);
        }
      }
      handleRouteError(res, error, "Failed to save document");
    }
  });

  app.get("/api/documents/:id/download", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(String(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });

      const requester = (req as unknown as { authUser: User }).authUser;
      const isOwner = doc.employeeId === requester.id;
      const isAdmin = requester.role === "admin";
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const exists = await documentExists(doc.filePath);
      if (!exists) {
        return res.status(404).json({ message: "File not found on server" });
      }

      res.setHeader("X-Content-Type-Options", "nosniff");

      const inline = req.query.view === "inline";
      const disposition = inline
        ? `inline; filename="${doc.fileName}"`
        : `attachment; filename="${doc.fileName}"`;
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", disposition);

      if (isObjectStoragePath(doc.filePath)) {
        const { stream, size } = await streamDocument(doc.filePath);
        if (size) res.setHeader("Content-Length", String(size));
        stream.on("error", (err) => {
          console.error("Document stream error:", err);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        return stream.pipe(res);
      }

      return fs.createReadStream(doc.filePath).pipe(res);
    } catch (error) {
      console.error("Failed to download document:", error);
      handleRouteError(res, error, "Failed to download document");
    }
  });

  app.patch("/api/documents/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const { status } = req.body;
    if (!status || !["uploaded", "reviewed", "missing"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    try {
      const adminUser = (req as any).authUser as User;
      const doc = await storage.updateDocument(String(req.params.id), {
        status,
        ...(status === "reviewed" ? { reviewedBy: adminUser.id, reviewedAt: new Date() } : {}),
      });
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (error) {
      handleRouteError(res, error, "Failed to update document");
    }
  });

  app.delete("/api/documents/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    try {
      const doc = await storage.getDocument(String(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });

      try {
        await deleteStoredDocument(doc.filePath);
      } catch (err) {
        console.error("Failed to delete document file:", err);
      }

      await storage.deleteDocument(doc.id);
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, "Failed to delete document");
    }
  });

  const ALLOWED_REQUIRED_DOC_TYPES = ALLOWED_DOCUMENT_TYPES;
  const ALLOWED_SCOPE_TYPES = ["global", "company", "location", "department", "employee"] as const;

  const certificationBodySchema = z.object({
    employeeId: z.string().min(1).optional(),
    name: z.string().min(1).max(200),
    issuer: z.string().max(200).nullable().optional(),
    issueDate: z.string().nullable().optional(),
    expirationDate: z.string().nullable().optional(),
    documentId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    status: z.enum(["valid", "expiring_soon", "expired", "archived"]).optional(),
  });

  app.get("/api/users/:id/certifications", requireAuth, async (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as unknown as { authUser: User }).authUser;
    let allowed = requester.id === targetId || requester.role === "admin";
    if (!allowed && requester.role === "manager") {
      const target = await storage.getUser(targetId);
      if (target) {
        const targetDeptIds = userDepartmentIds(target);
        if (targetDeptIds.length > 0) {
          const managedDepts = await storage.getDepartmentsForManager(requester.id);
          allowed = managedDepts.some((d) => targetDeptIds.includes(d.id));
        }
      }
    }
    if (!allowed) return res.status(403).json({ message: "Forbidden" });
    try {
      const certs = await storage.getCertificationsByEmployee(targetId);
      res.json(certs);
    } catch (err) {
      console.error("Failed to fetch certifications:", err);
      handleRouteError(res, err, "Failed to fetch certifications");
    }
  });

  app.get("/api/certifications", requireAuth, requirePermission("users.view"), async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const certs = await storage.getAllCertifications({ status });
      res.json(certs);
    } catch (err) {
      console.error("Failed to fetch certifications:", err);
      handleRouteError(res, err, "Failed to fetch certifications");
    }
  });

  async function createCertificationHandler(req: any, res: any, employeeId: string) {
    const parsed = certificationBodySchema.safeParse({ ...(req.body || {}), employeeId });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid certification data", errors: parsed.error.flatten() });
    }
    const adminUser = req.authUser as User;
    const employee = await storage.getUser(employeeId);
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    try {
      const created = await storage.createCertification({
        employeeId,
        name: parsed.data.name,
        issuer: parsed.data.issuer ?? null,
        issueDate: parsed.data.issueDate ?? null,
        expirationDate: parsed.data.expirationDate ?? null,
        documentId: parsed.data.documentId ?? null,
        notes: parsed.data.notes ?? null,
        status: parsed.data.status ?? "valid",
        createdBy: adminUser.id,
      });
      try {
        const { syncCertificationStatuses } = await import("./services/lifecycleAlerts");
        await syncCertificationStatuses();
      } catch (syncErr) {
        console.warn("syncCertificationStatuses after create failed:", syncErr);
      }
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "certification",
        targetId: created.id,
        action: "certification.create",
        newValue: created,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.status(201).json(created);
    } catch (err) {
      console.error("Failed to create certification:", err);
      handleRouteError(res, err, "Failed to create certification");
    }
  }

  app.post("/api/certifications", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const employeeId = (req.body || {}).employeeId;
    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });
    return createCertificationHandler(req, res, employeeId);
  });

  app.patch("/api/certifications/:id", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const parsed = certificationBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid certification data", errors: parsed.error.flatten() });
    }
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getCertification(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      const expirationChanged = parsed.data.expirationDate !== undefined && parsed.data.expirationDate !== existing.expirationDate;
      const updated = await storage.updateCertification(String(req.params.id), parsed.data);
      const ctx = getAuditContext(req);
      const action = parsed.data.status === "archived" ? "certification.archive" : "certification.update";
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "certification",
        targetId: String(req.params.id),
        action,
        oldValue: existing,
        newValue: updated,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      try {
        const { syncCertificationStatuses, resolveCertificationAlertsFor } = await import("./services/lifecycleAlerts");
        await syncCertificationStatuses();
        const archivedNow = parsed.data.status === "archived" && existing.status !== "archived";
        if (expirationChanged || archivedNow) {
          await resolveCertificationAlertsFor(String(req.params.id), adminUser.id);
        }
      } catch (syncErr) {
        console.warn("certification PATCH alert sync failed:", syncErr);
      }
      res.json(updated);
    } catch (err) {
      console.error("Failed to update certification:", err);
      handleRouteError(res, err, "Failed to update certification");
    }
  });

  app.post(
    "/api/certifications/:id/document",
    requireAuth,
    requirePermission("users.edit"),
    documentUpload.single("file"),
    async (req, res) => {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });
      const adminUser = (req as unknown as { authUser: User }).authUser;
      const cert = await storage.getCertification(String(req.params.id));
      if (!cert) return res.status(404).json({ message: "Certification not found" });

      let storagePath: string | null = null;
      try {
        const uploaded = await uploadDocumentBuffer(file.buffer, file.originalname, file.mimetype);
        storagePath = uploaded.storagePath;
        const doc = await storage.createDocument({
          employeeId: cert.employeeId,
          documentType: "certification",
          fileName: file.originalname,
          filePath: uploaded.storagePath,
          mimeType: file.mimetype,
          fileSize: file.size,
          status: "uploaded",
          uploadedBy: adminUser.id,
        });
        const updated = await storage.updateCertification(String(req.params.id), { documentId: doc.id });
        const ctx = getAuditContext(req);
        await writeAuditLog({
          actorUserId: adminUser.id,
          targetType: "certification",
          targetId: String(req.params.id),
          action: "certification.attach_document",
          oldValue: { documentId: cert.documentId },
          newValue: { documentId: doc.id, fileName: file.originalname },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        res.status(201).json(updated);
      } catch (err) {
        console.error("Failed to attach certification document:", err);
        if (storagePath) {
          try { await deleteStoredDocument(storagePath); } catch (cleanupErr) {
            console.warn("Failed to clean up cert document storage after error:", cleanupErr);
          }
        }
        handleRouteError(res, err, "Failed to attach document");
      }
    },
  );

  app.delete("/api/certifications/:id", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getCertification(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      try {
        const { resolveCertificationAlertsFor } = await import("./services/lifecycleAlerts");
        await resolveCertificationAlertsFor(String(req.params.id), adminUser.id);
      } catch (resErr) {
        console.warn("Failed to resolve cert alerts before delete:", resErr);
      }
      await storage.deleteCertification(String(req.params.id));
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "certification",
        targetId: String(req.params.id),
        action: "certification.delete",
        oldValue: existing,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete certification:", err);
      handleRouteError(res, err, "Failed to delete certification");
    }
  });

  const requiredDocBodySchema = z.object({
    documentType: z.enum(ALLOWED_REQUIRED_DOC_TYPES as [string, ...string[]]),
    scopeType: z.enum(ALLOWED_SCOPE_TYPES),
    companyId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    dueOffsetDays: z.number().int().min(0).max(365).default(0),
    isActive: z.boolean().optional(),
  });

  function validateRequiredDocScope(data: {
    scopeType?: string;
    companyId?: string | null;
    locationId?: string | null;
    departmentId?: string | null;
    employeeId?: string | null;
  }): string | null {
    const scopeFkMap: Record<string, string | null | undefined> = {
      company: data.companyId,
      location: data.locationId,
      department: data.departmentId,
      employee: data.employeeId,
    };
    if (data.scopeType === "global") {
      const extras = Object.entries(scopeFkMap).filter(([, v]) => v != null);
      if (extras.length > 0) {
        return `scopeType='global' must not include scope FKs (${extras.map(([k]) => k + "Id").join(", ")})`;
      }
      return null;
    }
    if (data.scopeType && data.scopeType in scopeFkMap) {
      const requiredFk = scopeFkMap[data.scopeType];
      if (!requiredFk) {
        return `scopeType='${data.scopeType}' requires ${data.scopeType}Id`;
      }
      const others = Object.entries(scopeFkMap)
        .filter(([k, v]) => k !== data.scopeType && v != null);
      if (others.length > 0) {
        return `scopeType='${data.scopeType}' must not include other scope FKs (${others.map(([k]) => k + "Id").join(", ")})`;
      }
    }
    return null;
  }

  app.get("/api/required-documents", requireAuth, requirePermission("users.view"), async (req, res) => {
    try {
      const documentType = typeof req.query.documentType === "string" ? req.query.documentType : undefined;
      const isActiveRaw = req.query.isActive;
      const isActive = isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined;
      const scopeType = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
      const rules = await storage.getAllRequiredDocumentRules({ documentType, isActive, scopeType });
      res.json(rules);
    } catch (err) {
      console.error("Failed to fetch required document rules:", err);
      handleRouteError(res, err, "Failed to fetch required document rules");
    }
  });

  app.post("/api/required-documents", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const parsed = requiredDocBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rule data", errors: parsed.error.flatten() });
    }
    const scopeErr = validateRequiredDocScope(parsed.data);
    if (scopeErr) {
      return res.status(400).json({ message: scopeErr });
    }
    const adminUser = req.authUser as User;
    try {
      const created = await storage.createRequiredDocumentRule({
        ...parsed.data,
        isActive: parsed.data.isActive ?? true,
      });
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "required_document_rule",
        targetId: created.id,
        action: "required_document_rule.create",
        newValue: created,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      try {
        const { detectMissingDocuments } = await import("./services/lifecycleAlerts");
        const { createPolicyAlerts } = await import("./services/policyEnforcement");
        const generated = await detectMissingDocuments();
        if (generated.length > 0) await createPolicyAlerts(generated);
      } catch (evalErr) {
        console.error("Post-create rule evaluation failed:", evalErr);
      }
      res.status(201).json(created);
    } catch (err) {
      console.error("Failed to create required document rule:", err);
      handleRouteError(res, err, "Failed to create required document rule");
    }
  });

  app.patch("/api/required-documents/:id", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const parsed = requiredDocBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rule data", errors: parsed.error.flatten() });
    }
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getRequiredDocumentRule(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Required document rule not found" });
      const merged = {
        scopeType: parsed.data.scopeType ?? existing.scopeType,
        companyId: parsed.data.companyId !== undefined ? parsed.data.companyId : existing.companyId,
        locationId: parsed.data.locationId !== undefined ? parsed.data.locationId : existing.locationId,
        departmentId: parsed.data.departmentId !== undefined ? parsed.data.departmentId : existing.departmentId,
        employeeId: parsed.data.employeeId !== undefined ? parsed.data.employeeId : existing.employeeId,
      };
      const scopeErr = validateRequiredDocScope(merged);
      if (scopeErr) {
        return res.status(400).json({ message: scopeErr });
      }
      const updated = await storage.updateRequiredDocumentRule(String(req.params.id), parsed.data);
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "required_document_rule",
        targetId: String(req.params.id),
        action: "required_document_rule.update",
        oldValue: existing,
        newValue: updated,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      try {
        const { detectMissingDocuments } = await import("./services/lifecycleAlerts");
        const { createPolicyAlerts } = await import("./services/policyEnforcement");
        const generated = await detectMissingDocuments();
        if (generated.length > 0) await createPolicyAlerts(generated);
      } catch (evalErr) {
        console.error("Post-update rule evaluation failed:", evalErr);
      }
      res.json(updated);
    } catch (err) {
      console.error("Failed to update required document rule:", err);
      handleRouteError(res, err, "Failed to update required document rule");
    }
  });

  app.delete("/api/required-documents/:id", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getRequiredDocumentRule(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Required document rule not found" });
      await storage.deleteRequiredDocumentRule(String(req.params.id));
      try {
        const { auditOpenMissingDocumentAlerts } = await import("./services/lifecycleAlerts");
        await auditOpenMissingDocumentAlerts();
      } catch (auditErr) {
        console.warn("Failed to audit missing-document alerts after rule delete:", auditErr);
      }
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "required_document_rule",
        targetId: String(req.params.id),
        action: "required_document_rule.delete",
        oldValue: existing,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete required document rule:", err);
      handleRouteError(res, err, "Failed to delete required document rule");
    }
  });

  app.post("/api/required-documents/evaluate-now", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    const adminUser = req.authUser as User;
    try {
      const { detectMissingDocuments } = await import("./services/lifecycleAlerts");
      const { createPolicyAlerts } = await import("./services/policyEnforcement");
      const generated = await detectMissingDocuments();
      if (generated.length > 0) {
        await createPolicyAlerts(generated);
      }
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "required_document_rule",
        targetId: "evaluate-now",
        action: "required_document_rule.evaluate_now",
        newValue: { alertCount: generated.length },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.json({ ok: true, generatedAlertCount: generated.length });
    } catch (err) {
      console.error("Failed to evaluate missing documents:", err);
      handleRouteError(res, err, "Failed to evaluate missing documents");
    }
  });

  app.post("/api/users/:id/certifications", requireAuth, requirePermission("users.edit"), async (req: any, res) => {
    return createCertificationHandler(req, res, String(req.params.id));
  });

  // Resolve an employee's CURRENT payroll-company name (payroll-only assignment,
  // independent of dept/location). Pay-stub/tax-form documents are uploaded files
  // with no frozen snapshot, so we surface the employee's live payroll company.
  const resolvePayrollCompanyName = async (employeeId: string): Promise<string | null> => {
    const prof = await storage.getEmploymentProfile(employeeId);
    if (!prof?.payrollCompanyId) return null;
    const company = await storage.getCompany(prof.payrollCompanyId);
    return company?.name ?? null;
  };

  app.get("/api/payroll-documents/my", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const docs = await storage.getPayrollDocumentsByEmployee(userId);
      const payrollCompanyName = await resolvePayrollCompanyName(userId);
      const enriched = await Promise.all(docs.map(async (doc) => {
        const uploader = doc.uploadedBy ? await storage.getUser(doc.uploadedBy) : null;
        return { ...doc, uploaderName: uploader ? `${uploader.firstName} ${uploader.lastName}` : "System", payrollCompanyName };
      }));
      res.json(enriched);
    } catch (error) {
      handleRouteError(res, error, "Failed to fetch payroll documents");
    }
  });

  app.get("/api/payroll-documents", requireAuth, requirePermission("payroll.view_all"), async (_req, res) => {
    try {
      const docs = await storage.getAllPayrollDocuments();
      const companyNameByEmployee = new Map<string, string | null>();
      const enriched = await Promise.all(docs.map(async (doc) => {
        const employee = await storage.getUser(doc.employeeId);
        const uploader = doc.uploadedBy ? await storage.getUser(doc.uploadedBy) : null;
        if (!companyNameByEmployee.has(doc.employeeId)) {
          companyNameByEmployee.set(doc.employeeId, await resolvePayrollCompanyName(doc.employeeId));
        }
        return {
          ...doc,
          employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          uploaderName: uploader ? `${uploader.firstName} ${uploader.lastName}` : "System",
          payrollCompanyName: companyNameByEmployee.get(doc.employeeId) ?? null,
        };
      }));
      res.json(enriched);
    } catch (error) {
      handleRouteError(res, error, "Failed to fetch payroll documents");
    }
  });

  const payrollDocSchema = z.object({
    employeeId: z.string().min(1),
    documentCategory: z.enum(["pay_stub", "tax_form", "other"]),
    documentName: z.string().min(1),
    payPeriod: z.string().min(1),
    grossPay: z.number().nullable().optional(),
    netPay: z.number().nullable().optional(),
    fileName: z.string().nullable().optional(),
    fileSize: z.number().nullable().optional(),
    mimeType: z.string().nullable().optional(),
  });

  app.post("/api/payroll-documents", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    const parsed = payrollDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequestFromZod(res, parsed, "Invalid payroll document");
    }
    try {
      const doc = await storage.createPayrollDocument({
        ...parsed.data,
        grossPay: parsed.data.grossPay ?? null,
        netPay: parsed.data.netPay ?? null,
        fileName: parsed.data.fileName ?? null,
        fileSize: parsed.data.fileSize ?? null,
        mimeType: parsed.data.mimeType ?? null,
        uploadedBy: req.authUser.id,
      });
      res.status(201).json(doc);
    } catch (error) {
      handleRouteError(res, error, "Failed to create payroll document");
    }
  });

  app.post("/api/payroll-documents/my", requireAuth, async (req: any, res) => {
    const selfUploadSchema = z.object({
      documentType: z.string().min(1),
      documentCategory: z.enum(["pay_stub", "tax_form", "other"]),
      payPeriod: z.string().min(1),
      fileName: z.string().nullable().optional(),
      fileSize: z.number().nullable().optional(),
      mimeType: z.string().nullable().optional(),
    });
    const parsed = selfUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequestFromZod(res, parsed, "Invalid upload data");
    }
    try {
      const doc = await storage.createPayrollDocument({
        employeeId: req.authUser.id,
        documentName: parsed.data.documentType,
        documentCategory: parsed.data.documentCategory,
        payPeriod: parsed.data.payPeriod,
        grossPay: null,
        netPay: null,
        fileName: parsed.data.fileName ?? null,
        fileSize: parsed.data.fileSize ?? null,
        mimeType: parsed.data.mimeType ?? null,
        uploadedBy: req.authUser.id,
      });
      res.status(201).json(doc);
    } catch (error) {
      handleRouteError(res, error, "Failed to upload document");
    }
  });

  app.delete("/api/payroll-documents/:id", requireAuth, requirePermission("payroll.manage"), async (req, res) => {
    try {
      const doc = await storage.getPayrollDocument(String(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      await storage.deletePayrollDocument(doc.id);
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, "Failed to delete payroll document");
    }
  });

  app.get("/api/pto-balances/all", requireAuth, requirePermission("pto.view_all"), async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const departments = await storage.getAllDepartments();
      const deptMap = new Map(departments.map(d => [d.id, d]));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const deptManagerMap = await buildDeptManagerNameMap(userMap);
      const currentYear = new Date().getFullYear();
      const balances = await Promise.all(allUsers.filter(u => u.id !== "admin-dev-001").map(async (user) => {
        const ptoSettings = await storage.getEmployeePtoSettings(user.id);
        // Resolve the PTO policy through the unified engine (policy_assignments +
        // precedence), NOT the legacy employee_pto_settings.pto_policy_id link, so
        // balances reflect employee-level assignments edited via
        // PUT /api/employee-pto-assignment/:userId.
        const policy = await storage.getEmployeePtoPolicy(user.id);
        const totalVacation = (policy?.accrualType === "per_hours_worked" && ptoSettings?.vacationHoursOverride == null)
          ? await storage.computeAnnualVacationEntitlement(user.id)
          : (ptoSettings?.vacationHoursOverride ?? policy?.accrualHoursPerYear ?? 120);
        const totalSick = ptoSettings?.sickHoursOverride ?? 80;
        const totalPersonal = ptoSettings?.personalHoursOverride ?? policy?.personalHoursPerYear ?? 40;
        const userRequests = await storage.getTimeOffRequestsByUser(user.id);
        const inCurrentYear = (r: typeof userRequests[number]) =>
          new Date(r.startDate).getFullYear() === currentYear;
        const sumHours = (type: string, statuses: string[]) =>
          userRequests
            .filter(r => r.type === type && statuses.includes(r.status) && inCurrentYear(r))
            .reduce((s, r) => s + (r.hoursApproved ?? r.hoursRequested ?? 8), 0);
        const usedVacation = sumHours("vacation", ["approved", "partially_approved"]);
        const usedSick = sumHours("sick", ["approved", "partially_approved"]);
        const usedPersonal = sumHours("personal", ["approved", "partially_approved"]);
        const pendingVacation = sumHours("vacation", ["pending"]);
        const pendingSick = sumHours("sick", ["pending"]);
        const pendingPersonal = sumHours("personal", ["pending"]);
        const display = resolveMembershipDisplay(user, deptMap, null, deptManagerMap);
        return {
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          departmentId: display.departmentId,
          departmentName: display.departmentName || "Unassigned",
          profileImageUrl: user.profileImageUrl,
          managerNames: display.managerNames,
          vacation: { total: totalVacation, used: usedVacation, pending: pendingVacation },
          sick: { total: totalSick, used: usedSick, pending: pendingSick },
          personal: { total: totalPersonal, used: usedPersonal, pending: pendingPersonal },
        };
      }));
      res.json(balances);
    } catch (error) {
      console.error("Error fetching PTO balances:", error);
      handleRouteError(res, error, "Failed to fetch PTO balances");
    }
  });

  app.get("/api/companies", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    if (user.role === "admin") {
      const allCompanies = await storage.getAllCompanies();
      const pagination = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
      if (pagination.paginated) {
        const data = allCompanies.slice(pagination.offset, pagination.offset + pagination.limit);
        return res.json({ data, total: allCompanies.length, limit: pagination.limit, offset: pagination.offset });
      }
      // Companies is a small table consumed by pickers as a bare array; cap
      // defensively so the response is bounded even without client params.
      return res.json(allCompanies.slice(0, MAX_PAGE_SIZE));
    }
    if (user.companyId) {
      const company = await storage.getCompany(user.companyId);
      return res.json(company ? [company] : []);
    }
    return res.json([]);
  });

  app.get("/api/companies/:id", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const company = await storage.getCompany(String(req.params.id));
    if (!company) return res.status(404).json({ message: "Company not found" });
    if (user.role !== "admin" && user.companyId !== company.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(company);
  });

  app.post("/api/companies", requireAuth, requirePermission("company.create"), async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.createCompany(parsed.data);
    res.status(201).json(company);
  });

  app.patch("/api/companies/:id", requireAuth, requirePermission("company.edit"), async (req, res) => {
    const parsed = insertCompanySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.updateCompany(String(req.params.id), parsed.data);
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json(company);
  });

  app.delete("/api/companies/:id", requireAuth, requirePermission("company.delete"), async (req, res) => {
    const company = await storage.getCompany(String(req.params.id));
    if (!company) return res.status(404).json({ message: "Company not found" });
    await storage.deleteCompany(String(req.params.id));
    res.status(204).send();
  });

  // Task #258: locations can belong to multiple companies. The list/detail
  // responses include a `companyIds` array (always non-empty: at minimum the
  // primary `locations.companyId`). POST/PATCH accept an optional
  // `companyIds: string[]` body field; when omitted the location keeps its
  // existing companies.
  const enrichLocation = async (loc: Location) => {
    const companyIds = await storage.getLocationCompanyIds(loc.id);
    const merged = Array.from(new Set([
      ...(loc.companyId ? [loc.companyId] : []),
      ...companyIds,
    ]));
    return { ...loc, companyIds: merged };
  };
  const enrichLocations = async (locs: Location[]) => {
    const map = await storage.getLocationCompanyIdsMap(locs.map((l) => l.id));
    return locs.map((l) => ({
      ...l,
      companyIds: Array.from(new Set([
        ...(l.companyId ? [l.companyId] : []),
        ...(map[l.id] || []),
      ])),
    }));
  };

  app.get("/api/locations", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const companyId = req.query.companyId as string | undefined;

    if (user.role === "admin") {
      if (companyId) {
        return res.json(await enrichLocations(await storage.getLocationsByCompany(companyId)));
      }
      return res.json(await enrichLocations(await storage.getAllLocations()));
    }
    if (user.companyId) {
      const locs = await storage.getLocationsByCompany(user.companyId);
      if (user.locationId) {
        return res.json(await enrichLocations(locs.filter(l => l.id === user.locationId)));
      }
      return res.json(await enrichLocations(locs));
    }
    return res.json([]);
  });

  app.get("/api/locations/:id", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const location = await storage.getLocation(String(req.params.id));
    if (!location) return res.status(404).json({ message: "Location not found" });
    const companyIds = await storage.getLocationCompanyIds(String(req.params.id));
    const merged = Array.from(new Set([
      ...(location.companyId ? [location.companyId] : []),
      ...companyIds,
    ]));
    if (user.role !== "admin" && (!user.companyId || !merged.includes(user.companyId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role !== "admin" && user.locationId && user.locationId !== location.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json({ ...location, companyIds: merged });
  });

  const locationBodySchema = insertLocationSchema.extend({
    companyIds: z.array(z.string().min(1)).optional(),
  });

  app.post("/api/locations", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const parsed = locationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const { companyIds, ...locationData } = parsed.data;
    // If extra companyIds were supplied but no primary companyId, pick the first.
    if (!locationData.companyId && companyIds && companyIds.length > 0) {
      locationData.companyId = companyIds[0];
    }
    const location = await storage.createLocation(locationData);
    if (companyIds && companyIds.length > 0) {
      await storage.setLocationCompanyIds(location.id, companyIds);
    }
    res.status(201).json(await enrichLocation(location));
  });

  app.patch("/api/locations/:id", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const parsed = locationBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const { companyIds, ...locationData } = parsed.data;
    const before = await storage.getLocation(String(req.params.id));
    if (!before) return res.status(404).json({ message: "Location not found" });
    const location = await storage.updateLocation(String(req.params.id), locationData);
    if (!location) return res.status(404).json({ message: "Location not found" });
    if (companyIds !== undefined) {
      await storage.setLocationCompanyIds(location.id, companyIds);
    }
    const actor = (req as any).authUser as User | undefined;
    if (actor) {
      await writeAuditLog({
        actorUserId: actor.id,
        targetType: "location",
        targetId: location.id,
        action: "location.update",
        oldValue: {
          name: before.name,
          code: before.code,
          timezone: before.timezone,
          isActive: before.isActive,
        },
        newValue: {
          name: location.name,
          code: location.code,
          timezone: location.timezone,
          isActive: location.isActive,
        },
        context: getAuditContext(req),
      });
    }
    res.json(await enrichLocation(location));
  });

  app.delete("/api/locations/:id", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const location = await storage.getLocation(String(req.params.id));
    if (!location) return res.status(404).json({ message: "Location not found" });
    await storage.deleteLocation(String(req.params.id));
    res.status(204).send();
  });

  app.get("/api/locations/:locationId/addresses", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const location = await storage.getLocation(String(req.params.locationId));
    if (!location) return res.status(404).json({ message: "Location not found" });
    const addresses = await storage.getLocationAddresses(String(req.params.locationId));
    res.json(addresses);
  });

  app.post("/api/locations/:locationId/addresses", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const location = await storage.getLocation(String(req.params.locationId));
    if (!location) return res.status(404).json({ message: "Location not found" });
    const parsed = insertLocationAddressSchema.safeParse({ ...req.body, locationId: String(req.params.locationId) });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid address data", errors: parsed.error.flatten() });
    }
    const address = await storage.createLocationAddress(parsed.data);
    res.status(201).json(address);
  });

  app.patch("/api/locations/:locationId/addresses/:id", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const existing = await storage.getLocationAddress(String(req.params.id));
    if (!existing || existing.locationId !== String(req.params.locationId)) {
      return res.status(404).json({ message: "Address not found" });
    }
    const parsed = insertLocationAddressSchema.omit({ locationId: true }).partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid address data", errors: parsed.error.flatten() });
    }
    const address = await storage.updateLocationAddress(String(req.params.id), parsed.data);
    res.json(address);
  });

  app.delete("/api/locations/:locationId/addresses/:id", requireAuth, requirePermission("locations.manage"), async (req, res) => {
    const existing = await storage.getLocationAddress(String(req.params.id));
    if (!existing || existing.locationId !== String(req.params.locationId)) {
      return res.status(404).json({ message: "Address not found" });
    }
    await storage.deleteLocationAddress(String(req.params.id));
    res.status(204).send();
  });

  // Task #418: pull optional device coordinates off a clock-in payload. Returns
  // nulls for anything missing or non-finite — geofencing treats "no coords" as
  // a required-but-missing signal rather than throwing.
  function parsePunchCoords(body: any): {
    latitude: number | null;
    longitude: number | null;
  } {
    // Only accept genuine numeric coordinates. We must NOT coerce here:
    // Number(null) === 0, which would turn an intentional "no location"
    // (denied/unavailable GPS) into a valid (0,0) punch and break the
    // required-but-missing geofence case.
    const rawLat = body?.latitude;
    const rawLng = body?.longitude;
    return {
      latitude: typeof rawLat === "number" && Number.isFinite(rawLat) ? rawLat : null,
      longitude: typeof rawLng === "number" && Number.isFinite(rawLng) ? rawLng : null,
    };
  }

  // Task #418: SerpApi-backed address autocomplete proxy. The single key lives
  // server-side; the response carries parsed address parts AND lat/lng so the
  // client can fill the form and silently store coordinates in one round-trip.
  app.get("/api/places/autocomplete", requireAuth, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const result = await autocompleteAddress(q);
      res.json(result);
    } catch (error) {
      console.error("Address autocomplete error:", error);
      res.json({ available: isSerpApiConfigured(), predictions: [] });
    }
  });

  async function enrichDepartmentsWithManagers(depts: Department[]) {
    return Promise.all(depts.map(async (dept) => {
      const managers = await storage.getDepartmentManagers(dept.id);
      return { ...dept, managerIds: managers.map(m => m.userId) };
    }));
  }

  app.get("/api/departments", requireAuth, requirePermission("departments.view"), async (req, res) => {
    const locationId = req.query.locationId as string | undefined;

    // Departments are a single shared list across all companies (Task #433).
    // Anyone with departments.view sees the full list; the only narrowing kept
    // is the optional location filter.
    const depts = locationId
      ? await storage.getDepartmentsByLocation(locationId)
      : await storage.getAllDepartments();

    res.json(await enrichDepartmentsWithManagers(depts));
  });

  const managerIdsSchema = z.array(z.string()).optional().default([]);

  app.post("/api/departments", requireAuth, requirePermission("departments.create"), async (req, res) => {
    // Departments are a single shared list across all companies (Task #433):
    // companyId is ignored entirely — it never scopes or gates creation.
    const { managerIds: rawManagerIds, companyId: _ignoredCompanyId, ...deptData } = req.body;
    const parsed = insertDepartmentSchema.safeParse(deptData);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    const mgrParsed = managerIdsSchema.safeParse(rawManagerIds);
    if (!mgrParsed.success) {
      return res.status(400).json({ message: "Invalid managerIds, expected an array of strings" });
    }
    const uniqueManagerIds = [...new Set(mgrParsed.data)];
    try {
      const dept = await storage.createDepartment(parsed.data);
      if (uniqueManagerIds.length > 0) {
        await storage.setDepartmentManagers(dept.id, uniqueManagerIds);
      }
      const managers = await storage.getDepartmentManagers(dept.id);
      res.status(201).json({ ...dept, managerIds: managers.map(m => m.userId) });
    } catch (error: any) {
      // Department names are globally unique across all companies (Task #433).
      if (error?.code === "23505") {
        return res.status(409).json({ message: "A department with this name already exists." });
      }
      return handleRouteError(res, error, "Failed to create department");
    }
  });

  app.patch("/api/departments/:id", requireAuth, requirePermission("departments.edit"), async (req, res) => {
    // companyId is ignored entirely — departments are company-independent (Task #433).
    const { managerIds: rawManagerIds, companyId: _ignoredCompanyId, ...deptData } = req.body;
    const parsed = insertDepartmentSchema.partial().safeParse(deptData);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    try {
      const dept = await storage.updateDepartment(String(req.params.id), parsed.data);
      if (!dept) return res.status(404).json({ message: "Department not found" });
      if (rawManagerIds !== undefined) {
        const mgrParsed = managerIdsSchema.safeParse(rawManagerIds);
        if (!mgrParsed.success) {
          return res.status(400).json({ message: "Invalid managerIds, expected an array of strings" });
        }
        await storage.setDepartmentManagers(dept.id, [...new Set(mgrParsed.data)]);
      }
      const managers = await storage.getDepartmentManagers(dept.id);
      res.json({ ...dept, managerIds: managers.map(m => m.userId) });
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "A department with this name already exists." });
      }
      return handleRouteError(res, error, "Failed to update department");
    }
  });

  app.delete("/api/departments/:id", requireAuth, requirePermission("departments.edit"), async (req, res) => {
    await storage.deleteDepartment(String(req.params.id));
    res.status(204).send();
  });

  app.get("/api/profile/details", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const userId = authUser.id;

    try {
      const user = await storage.getUser(userId);
      if (!user) return res.sendStatus(404);

      const emp = await storage.getEmploymentProfile(userId);

      const [company, location, department, payrollCompany] = await Promise.all([
        user.companyId ? storage.getCompany(user.companyId) : null,
        user.locationId ? storage.getLocation(user.locationId) : null,
        user.departmentId ? storage.getDepartment(user.departmentId) : null,
        emp?.payrollCompanyId ? storage.getCompany(emp.payrollCompanyId) : null,
      ]);

      const year = new Date().getFullYear();
      const balances = await storage.getTimeOffBalancesByUser(userId, year);

      const vacationBalance = balances?.find(b => b.type === "vacation");
      const sickBalance = balances?.find(b => b.type === "sick");
      const personalBalance = balances?.find(b => b.type === "personal");

      return res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,

        divisionName: company?.name ?? "—",
        companyName: company?.name ?? "—",
        locationName: location?.name ?? "—",
        departmentName: department?.name ?? "—",

        payrollCompanyId: emp?.payrollCompanyId ?? null,
        payrollCompanyName: payrollCompany?.name ?? null,

        employmentType: emp?.employmentType ?? "—",
        taxClassification: emp?.taxClassification ?? "W-2",
        payType: emp?.payType ?? "—",
        hireDate: emp?.hireDate ?? null,
        overtimeEligible: emp?.overtimeEligible ?? false,

        vacationBalance: vacationBalance ? vacationBalance.totalHours - vacationBalance.usedHours : 0,
        sickBalance: sickBalance ? sickBalance.totalHours - sickBalance.usedHours : 0,
        personalBalance: personalBalance ? personalBalance.totalHours - personalBalance.usedHours : 0,
      });
    } catch (err) {
      console.error("[GET /api/profile/details]", err);
      return handleRouteError(res, err, "Failed to load profile details");
    }
  });

  app.get("/api/employment-profiles", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const all = await storage.getAllEmploymentProfiles();
    if (authUser.role === "admin") return res.json(all);
    if (authUser.role === "manager") {
      const scopedIds = await storage.getScopedUserIds(authUser);
      return res.json(all.filter((p) => scopedIds.has(p.userId)));
    }
    res.json(all.filter((p) => p.userId === authUser.id));
  });

  app.get("/api/employment-profiles/:userId", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const targetUserId = String(req.params.userId);

    if (authUser.role !== "admin" && authUser.id !== targetUserId) {
      if (authUser.role === "manager") {
        const scopedIds = await storage.getScopedUserIds(authUser);
        if (!scopedIds.has(targetUserId)) {
          return res.status(403).json({ message: "Forbidden" });
        }
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const profile = await storage.getEmploymentProfile(targetUserId);
    if (!profile) return res.status(404).json({ message: "Employment profile not found" });
    res.json(profile);
  });

  app.post("/api/employment-profiles", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const existing = await storage.getEmploymentProfile(parsed.data.userId);
    if (existing) {
      return res.status(409).json({ message: "Employment profile already exists for this user" });
    }
    const data = { ...parsed.data };
    if (data.payType === "hourly" && !(data.hourlyRate && data.hourlyRate > 0)) {
      return res.status(400).json({ message: "Hourly pay type requires a positive Hourly Rate." });
    }
    if (data.payType === "daily" && !(data.dailySalary && data.dailySalary > 0)) {
      return res.status(400).json({ message: "Daily pay type requires a positive Daily Rate." });
    }
    if (data.payType === "salary" && !(data.weeklySalary && data.weeklySalary > 0)) {
      return res.status(400).json({ message: "Salary pay type requires a positive Weekly Salary." });
    }
    if (data.payType === "contractual") {
      data.hourlyRate = null;
      data.dailySalary = null;
      data.weeklySalary = null;
    }
    if (data.payType && req.body?.overtimeEligible === undefined) {
      data.overtimeEligible = data.payType === "hourly";
    }
    const profile = await storage.createEmploymentProfile(data);
    res.status(201).json(profile);
  });

  app.patch("/api/employment-profiles/:userId", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const before = await storage.getEmploymentProfile(String(req.params.userId));
    const data = { ...parsed.data };
    const payTypeChanged = data.payType !== undefined && data.payType !== before?.payType;
    const rateTouched =
      data.hourlyRate !== undefined ||
      data.dailySalary !== undefined ||
      data.weeklySalary !== undefined;
    if (payTypeChanged || rateTouched) {
      const nextPayType = data.payType ?? before?.payType;
      const nextHourly = data.hourlyRate !== undefined ? data.hourlyRate : before?.hourlyRate;
      const nextDaily = data.dailySalary !== undefined ? data.dailySalary : before?.dailySalary;
      const nextWeekly = data.weeklySalary !== undefined ? data.weeklySalary : before?.weeklySalary;
      if (nextPayType === "hourly" && !(nextHourly && nextHourly > 0)) {
        return res.status(400).json({ message: "Hourly pay type requires a positive Hourly Rate." });
      }
      if (nextPayType === "daily" && !(nextDaily && nextDaily > 0)) {
        return res.status(400).json({ message: "Daily pay type requires a positive Daily Rate." });
      }
      if (nextPayType === "salary" && !(nextWeekly && nextWeekly > 0)) {
        return res.status(400).json({ message: "Salary pay type requires a positive Weekly Salary." });
      }
      if (nextPayType === "contractual") {
        data.hourlyRate = null;
        data.dailySalary = null;
        data.weeklySalary = null;
      }
    }
    if (payTypeChanged && req.body?.overtimeEligible === undefined) {
      data.overtimeEligible = data.payType === "hourly";
    }
    const profile = await storage.updateEmploymentProfile(String(req.params.userId), data);
    if (!profile) return res.status(404).json({ message: "Employment profile not found" });

    try {
      const actor = (req as any).authUser as User | undefined;
      const auditableFields = [
        "employmentType",
        "payType",
        "hourlyRate",
        "weeklySalary",
        "dailySalary",
        "overtimeEligible",
        "holidayPayEnabled",
        "voluntaryPayEnabled",
        "taxClassification",
        "payrollCompanyId",
        "hireDate",
        "terminationDate",
      ] as const;
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};
      for (const key of auditableFields) {
        if ((data as any)[key] === undefined) continue;
        const beforeVal = (before as any)?.[key] ?? null;
        const afterVal = (profile as any)?.[key] ?? null;
        if (beforeVal !== afterVal) {
          oldValue[key] = beforeVal;
          newValue[key] = afterVal;
        }
      }
      if (Object.keys(newValue).length > 0) {
        await writeAuditLog({
          actorUserId: actor?.id || "system",
          targetType: "employment_profile",
          targetId: String(req.params.userId),
          action: "employment_profile.update",
          oldValue,
          newValue,
          ...getAuditContext(req),
        });
      }
    } catch (err) {
      console.error("Failed to write employment profile audit log:", err);
    }

    try {
      const actor = (req as any).authUser as User | undefined;
      await applyRoleForUser(String(req.params.userId), {
        actorUserId: actor?.id || "system",
        reason: "employment_profile.update",
      });
    } catch (err) {
      console.error("applyRoleForUser failed on profile update:", err);
    }

    invalidateUserCache();

    if (parsed.data.terminationDate && (!before?.terminationDate || before.terminationDate !== parsed.data.terminationDate)) {
      try {
        const employee = await storage.getUser(String(req.params.userId));
        if (employee) {
          const actorId = (req as any).authUser?.id || SUPER_ADMIN_USER_ID;
          const auditCtx = getAuditContext(req);
          await materializeOffboardingChecklist(employee, {
            terminationDate: parsed.data.terminationDate ?? null,
            startedBy: actorId,
            context: { ip: auditCtx.ipAddress ?? null, userAgent: auditCtx.userAgent ?? null },
          });
        }
      } catch (e) {
        console.error("Failed to materialize offboarding checklist:", e);
      }
    }


    res.json(profile);
  });

  async function getTeamUserIds(user: User): Promise<Set<string>> {
    if (user.role === "admin") {
      const allUsers = (await storage.getAllUsers()).filter(u => u.id !== SUPER_ADMIN_USER_ID);
      return new Set(allUsers.filter(u => u.id !== user.id).map(u => u.id));
    }
    const managedDepts = await storage.getDepartmentsForManager(user.id);
    if (managedDepts.length > 0) {
      const allUserIds = new Set<string>();
      for (const dept of managedDepts) {
        const deptUsers = await storage.getUsersByDepartment(dept.id);
        deptUsers.forEach(u => { if (u.id !== user.id) allUserIds.add(u.id); });
      }
      return allUserIds;
    }
    const ownDeptIds = userDepartmentIds(user);
    if (ownDeptIds.length > 0) {
      const teamIds = new Set<string>();
      for (const deptId of ownDeptIds) {
        const deptUsers = await storage.getUsersByDepartment(deptId);
        deptUsers.forEach(u => { if (u.id !== user.id) teamIds.add(u.id); });
      }
      return teamIds;
    }
    return new Set();
  }

  app.get("/api/time-off/pending", requireAuth, requirePermission("pto.approve"), async (req, res) => {
    const user = (req as any).authUser as User;
    const isRequesterAdmin = user.role === "admin";
    const teamIds = await getTeamUserIds(user);
    const requests = await storage.getPendingTimeOffRequests();
    const scopedRequests = requests.filter(r => teamIds.has(r.userId));
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    let deptMap = new Map<string, Department>();
    let locMap = new Map<string, Location>();
    let deptManagerMap = new Map<string, string[]>();
    if (isRequesterAdmin) {
      const allDepartments = await storage.getAllDepartments();
      deptMap = new Map(allDepartments.map(d => [d.id, d]));
      const allLocations = await storage.getAllLocations();
      locMap = new Map(allLocations.map(l => [l.id, l]));
      deptManagerMap = await buildDeptManagerNameMap(userMap);
    }

    const balanceTrackedTypes = new Set(["vacation", "sick", "personal"]);
    const uniqueUserIds = Array.from(new Set(scopedRequests
      .filter(r => balanceTrackedTypes.has(r.type))
      .map(r => r.userId)));
    const balanceEntries = await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        const balance = await storage.computeTimeOffBalanceDetailed(uid);
        return [uid, balance] as const;
      } catch (err) {
        console.error(`Failed to compute balance for user ${uid}:`, err);
        return [uid, null] as const;
      }
    }));
    const balanceMap = new Map(balanceEntries);

    const enriched = scopedRequests.map(r => {
      const u = userMap.get(r.userId);
      const userBalance = balanceMap.get(r.userId) ?? null;
      const currentBalance = (userBalance && balanceTrackedTypes.has(r.type))
        ? (userBalance as any)[r.type] ?? null
        : null;
      const base = {
        ...r,
        employeeName: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown",
        currentBalance,
      };
      if (!isRequesterAdmin) return base;
      const display = resolveMembershipDisplay(u, deptMap, locMap, deptManagerMap);
      return {
        ...base,
        departmentId: display.departmentId,
        locationId: display.locationId,
        departmentName: display.departmentName || "Unassigned",
        locationName: display.locationName || "Unassigned",
        managerNames: display.managerNames,
      };
    });
    res.json(enriched);
  });

  async function getDepartmentName(departmentId: string | null): Promise<string> {
    if (!departmentId) return "Unassigned";
    const dept = await storage.getDepartment(departmentId);
    return dept?.name || "Unassigned";
  }

  // Read the kiosk device id header (set by paired tablets) and resolve to an active
  // device. Returns null if unknown / inactive / unpaired so callers can degrade.
  async function resolveKioskFromHeaders(req: any) {
    const headerVal = req.headers?.["x-kiosk-device-id"];
    const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!deviceId || typeof deviceId !== "string") return null;
    const device = await storage.getKioskDevice(deviceId);
    if (!device || !device.isActive) return null;
    if (device.status === "unpaired") return null;
    return device;
  }

  // Friendly error helpers: kiosk endpoints must never leak raw exception text.
  function kioskError(res: any, code: number, errCode: string, message: string, extra: Record<string, any> = {}) {
    return res.status(code).json({ error: message, code: errCode, ...extra });
  }
  // Kiosk endpoints intentionally do NOT use handleRouteError: the public
  // kiosk frontend expects the `{ error, code }` schema and must never see
  // raw Postgres detail strings (PII risk on shared tablets). This wrapper
  // is the per-route friendly fallback for that surface.
  function wrapKiosk(handler: (req: any, res: any) => Promise<any>) {
    return async (req: any, res: any) => {
      try {
        await handler(req, res);
      } catch (err: any) {
        console.error("[kiosk] unhandled error:", err);
        if (!res.headersSent) {
          res.status(500).json({
            error: "Something went wrong. Please try again.",
            code: "internal_error",
          });
        }
      }
    };
  }

  function generatePairingCode(): string {
    // 6 digits, zero-padded; collision-checked at insert time.
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // Strict kiosk gate: only paired + active devices may use the public kiosk
  // surface. When this returns null, it has already written a {error, code}
  // 4xx response so callers can simply `return`.
  async function requireKioskDevice(req: any, res: any): Promise<Awaited<ReturnType<typeof storage.getKioskDevice>> | null> {
    const headerVal = req.headers?.["x-kiosk-device-id"];
    const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!deviceId || typeof deviceId !== "string") {
      kioskError(res, 400, "missing_device_id", "This tablet isn't paired yet. Please enter a pairing code.");
      return null;
    }
    const device = await storage.getKioskDevice(deviceId);
    if (!device) {
      kioskError(res, 404, "device_not_found", "This kiosk is no longer registered.");
      return null;
    }
    if (!device.isActive) {
      kioskError(res, 403, "device_inactive", "This kiosk has been turned off.");
      return null;
    }
    if (device.status === "unpaired") {
      kioskError(res, 403, "device_unpaired", "This kiosk was unpaired. Please enter a new pairing code.");
      return null;
    }
    return device;
  }

  function deriveDeviceStatus(d: { status: string; lastHeartbeat: Date | null; isActive: boolean }): "online" | "idle" | "offline" | "unpaired" | "inactive" {
    if (!d.isActive) return "inactive";
    if (d.status === "unpaired") return "unpaired";
    if (!d.lastHeartbeat) return "offline";
    const ageMs = Date.now() - new Date(d.lastHeartbeat).getTime();
    if (ageMs < 2 * 60 * 1000) return "online";
    if (ageMs < 10 * 60 * 1000) return "idle";
    return "offline";
  }

  app.post("/api/kiosk/lookup-pin", wrapKiosk(async (req, res) => {
    if (!(await requireKioskDevice(req, res))) return;
    const parsed = pinLookupSchema.safeParse(req.body);
    if (!parsed.success) {
      return kioskError(res, 400, "invalid_request", "Please enter a valid PIN.");
    }
    const user = await storage.getUserByPin(parsed.data.pin);
    if (!user) {
      return kioskError(res, 404, "invalid_pin", "We didn't recognize that PIN. Please try again.");
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    const allowedPunchSources = await getKioskAllowedSourcesForUser(user);
    const geofenceEnabled = (await storage.getEmployeeGeofencedAddresses(user.id)).length > 0;
    return res.json({ employee: { ...sanitizeUserForKiosk(user, deptName, allowedPunchSources), geofenceEnabled }, lastRecord: kioskLastRecord });
  }));

  app.get("/api/kiosk/search", wrapKiosk(async (req, res) => {
    if (!(await requireKioskDevice(req, res))) return;
    const query = req.query.q as string;
    if (!query || query.length < 1) {
      return res.json([]);
    }
    const matchedUsers = await storage.searchUsersByName(query);
    const results = await Promise.all(
      matchedUsers.map(async (u) => {
        const deptName = await getDepartmentName(u.departmentId);
        return sanitizeUserForKiosk(u, deptName);
      })
    );
    return res.json(results);
  }));

  app.get("/api/kiosk/employee/:id", wrapKiosk(async (req, res) => {
    if (!(await requireKioskDevice(req, res))) return;
    const id = String(req.params.id);
    if (!id) {
      return kioskError(res, 400, "invalid_request", "Please choose an employee.");
    }
    const user = await storage.getUser(id);
    if (!user) {
      return kioskError(res, 404, "employee_not_found", "We couldn't find that employee.");
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    const allowedPunchSources = await getKioskAllowedSourcesForUser(user);
    const geofenceEnabled = (await storage.getEmployeeGeofencedAddresses(user.id)).length > 0;
    return res.json({ employee: { ...sanitizeUserForKiosk(user, deptName, allowedPunchSources), geofenceEnabled }, lastRecord: kioskLastRecord });
  }));

  app.post("/api/kiosk/punch", wrapKiosk(async (req, res) => {
    const parsed = kioskPunchSchema.safeParse(req.body);
    if (!parsed.success) {
      return kioskError(res, 400, "invalid_request", "Please choose an employee and try again.");
    }
    const { employeeId, type } = parsed.data;
    const kioskDevice = await requireKioskDevice(req, res);
    if (!kioskDevice) return;
    const user = await storage.getUser(employeeId);
    if (!user) {
      return kioskError(res, 404, "employee_not_found", "We couldn't find that employee.");
    }
    const today = new Date().toISOString().split("T")[0];
    const deptName = await getDepartmentName(user.departmentId);

    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const attRules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;

    // Kiosk punches (PIN/name and face both land here) are the "kiosk" method.
    if (!isPunchSourceAllowed(attRules, "kiosk")) {
      return kioskError(res, 403, "policy_blocked", punchSourceBlockedMessage("kiosk"));
    }

    if (type === "clock_in") {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (lastRecord && lastRecord.clockIn && !lastRecord.clockOut && lastRecord.workDate === today) {
        return kioskError(res, 400, "already_clocked_in", "You're already clocked in.");
      }

      const now = new Date();
      const enforcement = await enforceClockIn(user, now, attRules, attendancePolicy?.policyName);

      if (!enforcement.allowed) {
        return kioskError(res, 403, "policy_blocked", enforcement.rejectionMessage || "Clock-in not allowed right now.");
      }

      // Shared punch-integrity validation (backstop for the DB open-punch guard).
      // Clock-in STILL blocks on overlap — overlapping shifts must never be created.
      const kioskInIntegrity = await validateProposedPunch({
        employeeId: user.id,
        clockIn: now,
        clockOut: undefined,
        candidateDates: [now.toISOString().split("T")[0]],
        allowFuturePunch: allowFuturePunchFromRules(attRules),
        now,
        timezone: await resolveEmployeeTimezone(user.id),
      });
      if (!kioskInIntegrity.ok) {
        return kioskError(res, 400, "invalid_punch", kioskInIntegrity.reason || "That punch isn't valid.");
      }

      const { latitude: punchLatitude, longitude: punchLongitude } =
        parsePunchCoords(parsed.data);

      let record;
      try {
        // Route through the transactional, advisory-locked clock-in so a kiosk
        // double-tap can't create two open punches. The unique index is the
        // backstop if two requests still slip through.
        record = await storage.clockIn(user.id, "kiosk", enforcement.roundedTime, {
          status: "in-progress",
          kioskDeviceId: kioskDevice.id,
          punchLatitude,
          punchLongitude,
        });
      } catch (err) {
        if (err instanceof DuplicateOpenPunchError) {
          return kioskError(res, 409, "already_clocked_in", "You're already clocked in.");
        }
        throw err;
      }

      // Geofencing never blocks the kiosk punch; out-of-bounds (or missing GPS
      // when required) just raises a manager-facing exception.
      await flagClockInGeofence({
        userId: user.id,
        punchLogId: record.id,
        workDate: record.workDate,
        punchTime: record.clockIn ?? now,
        punchLatitude,
        punchLongitude,
      });

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await writeLedgerEntry({
        category: "attendance",
        eventType: "clock_in",
        employeeId: user.id,
        actorUserId: user.id,
        entityType: "punch_log",
        entityId: record.id,
        workDate: record.workDate,
        beforeValue: null,
        afterValue: { clockIn: record.clockIn, status: record.status },
        source: "kiosk",
        ...getLedgerContext(req),
      });

      const scheduleWarning = await getScheduleWarning(user.id, "clock_in");
      try {
        (globalThis as any).__broadcastAttendanceUpdate?.({
          type: "kiosk_punch",
          employeeId: user.id,
          status: "clock_in",
        });
      } catch {}
      return res.json({
        record: { id: record.id, type: "clock_in", timestamp: record.clockIn },
        employee: sanitizeUserForKiosk(user, deptName),
        ...(scheduleWarning ? { scheduleWarning } : {}),
      });
    } else {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (!lastRecord || !lastRecord.clockIn || lastRecord.clockOut) {
        return kioskError(res, 400, "not_clocked_in", "You're not currently clocked in.");
      }

      const payrollPolicy = await getEffectivePolicy(user.companyId, user.id, "payroll", user);
      const payrollRules = payrollPolicy?.rules || DEFAULT_PAYROLL_RULES;

      const now = new Date();
      const roundedClockInTime = new Date(lastRecord.roundedClockIn ?? lastRecord.clockIn);
      const breakMinutes = lastRecord.breakMinutes || 0;

      const enforcement = enforceClockOut(roundedClockInTime, now, breakMinutes, attRules, payrollRules, user, attendancePolicy?.policyName);

      const timezone = await resolveEmployeeTimezone(user.id);

      // Shared punch-integrity validation: the closing time must be after the
      // open clock-in and not future-dated. An OVERLAP with another shift must
      // NOT block the clock-out (the employee would be stuck clocked in) — it's
      // flagged for a manager and the close is still recorded.
      const kioskOutIntegrity = await validateProposedPunch({
        employeeId: user.id,
        clockIn: lastRecord.clockIn,
        clockOut: now,
        punchId: lastRecord.id,
        candidateDates: [lastRecord.workDate, now.toISOString().split("T")[0]],
        allowFuturePunch: allowFuturePunchFromRules(attRules),
        now,
        timezone,
        overlapPolicy: "flag",
      });
      if (!kioskOutIntegrity.ok) {
        return kioskError(res, 400, "invalid_punch", kioskOutIntegrity.reason || "That punch isn't valid.");
      }

      const updated = await storage.closeOpenPunch(lastRecord.id, {
        clockOut: now,
        roundedClockOut: enforcement.roundedTime,
        hoursWorked: enforcement.hoursWorked,
        status: enforcement.status,
        // Stamp the kiosk that closed the punch so admins can see which device
        // each side of a shift came from.
        kioskDeviceId: kioskDevice.id,
      });

      // A second (double-tapped) clock-out finds the punch already closed and
      // no-ops cleanly instead of re-closing it.
      if (!updated) {
        return kioskError(res, 409, "not_clocked_in", "You're not currently clocked in.");
      }

      // Overlap detected but the close succeeded — raise a manager-facing
      // exception + alert so the duplicate/overlap can be reconciled. Never
      // breaks the clock-out.
      if (kioskOutIntegrity.overlap) {
        await flagPunchOverlapForReconciliation({
          userId: user.id,
          punchLogId: updated.id,
          workDate: updated.workDate,
          punchTime: updated.clockOut ?? now,
          overlap: kioskOutIntegrity.overlap,
        });
      }

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await checkPostExportModification(lastRecord.id, user.id);

      await writeLedgerEntry({
        category: "attendance",
        eventType: "clock_out",
        employeeId: user.id,
        actorUserId: user.id,
        entityType: "punch_log",
        entityId: lastRecord.id,
        workDate: lastRecord.workDate,
        hoursDelta: hoursDelta(null, updated?.hoursWorked),
        beforeValue: { clockOut: null, hoursWorked: lastRecord.hoursWorked, status: lastRecord.status },
        afterValue: { clockOut: updated?.clockOut, hoursWorked: updated?.hoursWorked, status: updated?.status },
        source: "kiosk",
        ...getLedgerContext(req),
      });

      const scheduleWarning = await getScheduleWarning(user.id, "clock_out");
      try {
        (globalThis as any).__broadcastAttendanceUpdate?.({
          type: "kiosk_punch",
          employeeId: user.id,
          status: "clock_out",
        });
      } catch {}
      return res.json({
        record: { id: updated?.id, type: "clock_out", timestamp: updated?.clockOut },
        employee: sanitizeUserForKiosk(user, deptName),
        ...(scheduleWarning ? { scheduleWarning } : {}),
      });
    }
  }));

  // Tablet submits a pairing code shown by an admin. On match, we return the
  // device id; the tablet stores it in localStorage and uses it going forward.
  app.post("/api/kiosk/pair", wrapKiosk(async (req, res) => {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{4,8}$/.test(code)) {
      return kioskError(res, 400, "invalid_code", "Please enter the 6-digit pairing code from your admin.");
    }
    const device = await storage.getKioskByPairingCode(code);
    if (!device) {
      return kioskError(res, 404, "invalid_code", "That code didn't match any kiosk. Please double-check with your admin.");
    }
    if (!device.isActive) {
      return kioskError(res, 403, "device_inactive", "This kiosk is currently inactive. Ask an admin to enable it.");
    }
    if (device.pairingCodeExpiresAt && new Date(device.pairingCodeExpiresAt).getTime() < Date.now()) {
      return kioskError(res, 410, "code_expired", "That pairing code has expired. Ask your admin for a new one.");
    }
    const paired = await storage.markKioskPaired(device.id);
    return res.json({
      deviceId: paired?.id ?? device.id,
      name: device.name,
      locationDescription: device.locationDescription,
    });
  }));

  // Tablet heartbeat: confirms the device is still paired/active. The tablet
  // pings this every minute and uses the response to know if it should drop back
  // to the pairing screen.
  app.post("/api/kiosk/heartbeat", wrapKiosk(async (req, res) => {
    const headerVal = req.headers?.["x-kiosk-device-id"];
    const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!deviceId || typeof deviceId !== "string") {
      return kioskError(res, 400, "missing_device_id", "This tablet isn't paired yet.");
    }
    const device = await storage.getKioskDevice(deviceId);
    if (!device) {
      return kioskError(res, 404, "device_not_found", "This kiosk is no longer registered.");
    }
    if (!device.isActive) {
      return kioskError(res, 403, "device_inactive", "This kiosk has been turned off.");
    }
    if (device.status === "unpaired") {
      return kioskError(res, 403, "device_unpaired", "This kiosk was unpaired. Please enter a new pairing code.");
    }
    await storage.updateKioskHeartbeat(device.id);
    return res.json({ ok: true, deviceId: device.id, status: "paired" });
  }));

  app.get("/api/attendance/status", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const userRole = req.authUser.role;
      const authUser = req.authUser as User;
      const current = await storage.getCurrentAttendance(userId);
      const todayHours = await storage.getTodayHours(userId);
      const weekHours = await storage.getWeekHours(userId);

      const attendancePolicy = await getEffectivePolicy(authUser.companyId, userId, "attendance", authUser);
      const allowedPunchSources = getAllowedPunchSources(attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES);

      // Task #418: tells the dashboard whether to request device location at
      // clock-in (geofencing applies only when the employee has at least one
      // geofenced location address).
      const geofencedAddresses = await storage.getEmployeeGeofencedAddresses(userId);
      const geofenceEnabled = geofencedAddresses.length > 0;

      const response: any = {
        isClockedIn: !!current,
        currentRecord: current ? punchLogToApiResponse(current) : null,
        todayHours,
        weekHours,
        // Lets the dashboard hide the self clock buttons when web/mobile aren't
        // allowed for this employee.
        allowedPunchSources,
        geofenceEnabled,
      };

      if (userRole === "admin" || userRole === "manager") {
        response.ptoBalance = await storage.computeTimeOffBalance(userId);
      }

      res.json(response);
    } catch (error) {
      console.error("Error fetching status:", error);
      handleRouteError(res, error, "Failed to fetch attendance status");
    }
  });

  app.post("/api/attendance/clock-in", requireAuth, attachPolicyContext("attendance"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const current = await storage.getCurrentAttendance(userId);
      if (current) {
        return res.status(409).json({ message: "You're already clocked in." });
      }

      const source = req.body?.source || "web";
      const rules = getPolicyRules(req, "attendance");
      if (!isPunchSourceAllowed(rules, source)) {
        return res.status(403).json({ message: punchSourceBlockedMessage(source) });
      }

      const now = new Date();
      const attPolicy = getResolvedPolicy(req, "attendance");
      const enforcement = await enforceClockIn(user, now, rules, attPolicy?.policyName);

      if (!enforcement.allowed) {
        return res.status(403).json({ message: enforcement.rejectionMessage });
      }

      // Shared punch-integrity validation (backstop for the DB open-punch guard;
      // also catches an overlap with another punch on the same day). Clock-in
      // STILL blocks on overlap — overlapping shifts must never be created.
      const integrity = await validateProposedPunch({
        employeeId: userId,
        clockIn: now,
        clockOut: undefined,
        candidateDates: [now.toISOString().split("T")[0]],
        allowFuturePunch: allowFuturePunchFromRules(rules),
        now,
        timezone: await resolveEmployeeTimezone(userId),
      });
      if (!integrity.ok) {
        return res.status(400).json({ message: integrity.reason });
      }

      const { latitude: punchLatitude, longitude: punchLongitude } =
        parsePunchCoords(req.body);

      const record = await storage.clockIn(userId, source, enforcement.roundedTime, {
        punchLatitude,
        punchLongitude,
      });

      // Geofencing never blocks the punch; it only raises a manager-facing
      // exception when the clock-in is outside the allowed radius (or required
      // but the device shared no location).
      await flagClockInGeofence({
        userId,
        punchLogId: record.id,
        workDate: record.workDate,
        punchTime: record.clockIn ?? now,
        punchLatitude,
        punchLongitude,
      });

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await writeLedgerEntry({
        category: "attendance",
        eventType: "clock_in",
        employeeId: userId,
        actorUserId: userId,
        entityType: "punch_log",
        entityId: record.id,
        workDate: record.workDate,
        beforeValue: null,
        afterValue: { clockIn: record.clockIn, status: record.status },
        source,
        ...getLedgerContext(req),
      });

      const scheduleWarning = await getScheduleWarning(userId, "clock_in");
      res.json({ ...punchLogToApiResponse(record), ...(scheduleWarning ? { scheduleWarning } : {}) });
    } catch (error) {
      console.error("Error clocking in:", error);
      handleRouteError(res, error, "Failed to clock in");
    }
  });

  app.post("/api/attendance/clock-out", requireAuth, attachPolicyContext("attendance", "payroll"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;

      const current = await storage.getCurrentAttendance(userId);
      if (!current || !current.clockIn) {
        return res.status(400).json({ message: "Not currently clocked in" });
      }

      const rules = getPolicyRules(req, "attendance");
      const payrollRules = getPolicyRules(req, "payroll");

      const source = req.body?.source || "web";
      if (!isPunchSourceAllowed(rules, source)) {
        return res.status(403).json({ message: punchSourceBlockedMessage(source) });
      }

      const now = new Date();
      const roundedClockInTime = new Date(current.roundedClockIn ?? current.clockIn);
      const breakMinutes = current.breakMinutes || 0;

      const attPolicy = getResolvedPolicy(req, "attendance");
      const enforcement = enforceClockOut(roundedClockInTime, now, breakMinutes, rules, payrollRules, user, attPolicy?.policyName);

      const timezone = await resolveEmployeeTimezone(userId);

      // Shared punch-integrity validation: the closing time must be after the
      // open clock-in and not future-dated. An OVERLAP with another shift must
      // NOT block the clock-out (the employee would be stuck clocked in) — it's
      // flagged for a manager and the close is still recorded.
      const integrity = await validateProposedPunch({
        employeeId: userId,
        clockIn: current.clockIn,
        clockOut: now,
        punchId: current.id,
        candidateDates: [current.workDate, now.toISOString().split("T")[0]],
        allowFuturePunch: allowFuturePunchFromRules(rules),
        now,
        timezone,
        overlapPolicy: "flag",
      });
      if (!integrity.ok) {
        return res.status(400).json({ message: integrity.reason });
      }

      const record = await storage.closeOpenPunch(current.id, {
        clockOut: now,
        roundedClockOut: enforcement.roundedTime,
        hoursWorked: enforcement.hoursWorked,
        status: enforcement.status,
      });

      // closeOpenPunch only updates a punch that is still open, so a second
      // (double-tapped or concurrent) clock-out lands here as a clean no-op
      // instead of re-closing an already-closed punch.
      if (!record) {
        return res.status(409).json({ message: "You're already clocked out." });
      }

      // Overlap detected but the close succeeded — raise a manager-facing
      // exception + alert so the duplicate/overlap can be reconciled. Never
      // breaks the clock-out.
      if (integrity.overlap) {
        await flagPunchOverlapForReconciliation({
          userId,
          punchLogId: record.id,
          workDate: record.workDate,
          punchTime: record.clockOut ?? now,
          overlap: integrity.overlap,
        });
      }

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await checkPostExportModification(record.id, userId);
      // Keep the canonical attendance ledger warm for this employee-day.
      void recomputeLedger(userId, [record.workDate]);

      await writeLedgerEntry({
        category: "attendance",
        eventType: "clock_out",
        employeeId: userId,
        actorUserId: userId,
        entityType: "punch_log",
        entityId: record.id,
        workDate: record.workDate,
        hoursDelta: hoursDelta(null, record.hoursWorked),
        beforeValue: { clockOut: null, hoursWorked: current.hoursWorked, status: current.status },
        afterValue: { clockOut: record.clockOut, hoursWorked: record.hoursWorked, status: record.status },
        source,
        ...getLedgerContext(req),
      });

      const scheduleWarning = await getScheduleWarning(userId, "clock_out");
      res.json({ ...punchLogToApiResponse(record), ...(scheduleWarning ? { scheduleWarning } : {}) });
    } catch (error) {
      console.error("Error clocking out:", error);
      handleRouteError(res, error, "Failed to clock out");
    }
  });

  const scheduleEntrySchema = z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isActive: z.boolean().default(true),
  });

  app.get("/api/employees/:employeeId/schedules", requireAuth, requirePermission("schedules.view"), async (req: any, res) => {
    try {
      const { employeeId } = req.params;
      const schedules = await storage.getEmployeeSchedules(employeeId);
      res.json(schedules);
    } catch (error) {
      console.error("Error fetching employee schedules:", error);
      handleRouteError(res, error, "Failed to fetch schedules");
    }
  });

  app.put("/api/employees/:employeeId/schedules", requireAuth, requirePermission("schedules.manage"), async (req: any, res) => {
    try {
      const { employeeId } = req.params;
      const scheduleEntries = req.body;
      if (!Array.isArray(scheduleEntries)) {
        return res.status(400).json({ message: "Request body must be an array of schedule entries" });
      }

      const validated = [];
      for (const entry of scheduleEntries) {
        const parsed = scheduleEntrySchema.safeParse(entry);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid schedule entry", errors: parsed.error.errors });
        }
        if (parsed.data.isActive && parsed.data.startTime >= parsed.data.endTime) {
          return res.status(400).json({ message: `Invalid schedule for ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][parsed.data.dayOfWeek]}: start time must be before end time` });
        }
        validated.push(parsed.data);
      }

      const existing = await storage.getEmployeeSchedules(employeeId);
      const existingByDay = new Map(existing.map(e => [e.dayOfWeek, e]));

      const results = [];
      for (const v of validated) {
        const prev = existingByDay.get(v.dayOfWeek);
        const unchanged = prev
          && prev.startTime === v.startTime
          && prev.endTime === v.endTime
          && prev.isActive === v.isActive;
        const preserveTemplateId = unchanged ? prev?.scheduleTemplateId ?? null : null;
        const result = await storage.upsertEmployeeSchedule({
          employeeId,
          dayOfWeek: v.dayOfWeek,
          startTime: v.startTime,
          endTime: v.endTime,
          isActive: v.isActive,
          scheduleTemplateId: preserveTemplateId,
        });
        results.push(result);
      }
      res.json(results);
    } catch (error) {
      console.error("Error saving employee schedules:", error);
      handleRouteError(res, error, "Failed to save schedules");
    }
  });

  app.get("/api/attendance/records", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const { startDate, endDate } = req.query;
      const records = await storage.getAttendanceRecords(
        userId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      // Identify which punch logs were created/updated by an approved correction request.
      const approvedExceptions = await db
        .select({ punchLogId: attendanceExceptions.punchLogId })
        .from(attendanceExceptions)
        .where(and(
          eq(attendanceExceptions.employeeId, userId),
          eq(attendanceExceptions.status, "approved"),
          isNotNull(attendanceExceptions.punchLogId),
        ));
      const correctedIds = new Set(approvedExceptions.map(e => e.punchLogId).filter(Boolean) as string[]);

      // Resolve kiosk names so the UI can render "via Kiosk — <name>" per row.
      const kioskIds = Array.from(new Set(records.map(r => r.kioskDeviceId).filter((x): x is string => !!x)));
      const kioskNameById = new Map<string, string>();
      for (const id of kioskIds) {
        const d = await storage.getKioskDevice(id);
        if (d) kioskNameById.set(id, d.name);
      }

      res.json(records.map(r => {
        const name = r.kioskDeviceId ? (kioskNameById.get(r.kioskDeviceId) ?? null) : null;
        return {
          ...punchLogToApiResponse(r),
          wasCorrected: correctedIds.has(r.id),
          kioskDeviceName: name,
          kiosk: r.kioskDeviceId && name ? { id: r.kioskDeviceId, name } : null,
        };
      }));
    } catch (error) {
      console.error("Error fetching records:", error);
      handleRouteError(res, error, "Failed to fetch attendance records");
    }
  });

  // --- FR-0075: direct manager/admin punch edit + delete -------------------
  // Resolve the set of employees a caller may act on for direct punch
  // management. HR admins (attendance.view_all) see everyone; managers
  // (attendance.view_team) see their team plus themselves. Returns null when
  // the caller lacks any attendance view permission so callers can 403.
  async function resolvePunchScope(
    req: any,
  ): Promise<{ users: User[]; canViewAll: boolean } | null> {
    const requester = req.authUser as User;
    const perms = await resolveUserPermissions(requester.id);
    const isSuper = perms.has("system.super_admin");
    const canViewAll = isSuper || perms.has("attendance.view_all");
    const canViewTeam = canViewAll || perms.has("attendance.view_team");
    if (!canViewTeam) return null;

    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuper);
    if (canViewAll) {
      return { users: allUsers, canViewAll: true };
    }
    const teamIds = await getTeamUserIds(requester);
    teamIds.add(requester.id);
    return { users: allUsers.filter((u) => teamIds.has(u.id)), canViewAll: false };
  }

  // Punch-level attendance table feed for Team View and Admin Live Attendance.
  // Filterable by employee, date range, and location, scoped to the caller's
  // authority. Returns the scoped employee + location option lists too so the
  // filter dropdowns work without requiring users.view / locations.view.
  app.get("/api/attendance/punches", requireAuth, async (req: any, res) => {
    try {
      const scope = await resolvePunchScope(req);
      if (!scope) {
        return res.status(403).json({ message: "Forbidden: missing attendance view permission" });
      }

      const { employeeId, startDate, endDate, locationId } = req.query as {
        employeeId?: string;
        startDate?: string;
        endDate?: string;
        locationId?: string;
      };
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (startDate && !dateRe.test(startDate)) {
        return res.status(400).json({ message: "startDate must be YYYY-MM-DD" });
      }
      if (endDate && !dateRe.test(endDate)) {
        return res.status(400).json({ message: "endDate must be YYYY-MM-DD" });
      }
      if (startDate && endDate && startDate > endDate) {
        return res.status(400).json({ message: "startDate must be on or before endDate" });
      }

      const locations = await storage.getAllLocations();
      const locNameById = new Map(locations.map((l) => [l.id, l.name]));

      const employeeOptions = scope.users
        .map((u) => ({
          id: u.id,
          name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Unknown",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const scopedLocIds = new Set<string>();
      for (const u of scope.users) {
        for (const lid of userLocationIds(u)) scopedLocIds.add(lid);
      }
      const locationOptions = Array.from(scopedLocIds)
        .map((id) => ({ id, name: locNameById.get(id) || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Apply employee + location filters to the scoped user set.
      let targetUsers = scope.users;
      if (locationId) {
        targetUsers = targetUsers.filter((u) => userLocationIds(u).includes(locationId));
      }
      if (employeeId) {
        targetUsers = targetUsers.filter((u) => u.id === employeeId);
      }
      const targetIds = targetUsers.map((u) => u.id);

      let punches: PunchLog[] = [];
      if (targetIds.length > 0) {
        const conds = [inArray(punchLogs.employeeId, targetIds)];
        if (startDate) conds.push(gte(punchLogs.workDate, startDate));
        if (endDate) conds.push(lte(punchLogs.workDate, endDate));
        punches = await db
          .select()
          .from(punchLogs)
          .where(and(...conds))
          .orderBy(desc(punchLogs.workDate), desc(punchLogs.clockIn));
      }

      const userById = new Map(scope.users.map((u) => [u.id, u]));
      const data = punches.map((p) => {
        const u = userById.get(p.employeeId);
        const empLocNames = u ? userLocationIds(u).map((id) => locNameById.get(id) || "Unknown") : [];
        return {
          id: p.id,
          employeeId: p.employeeId,
          employeeName: u
            ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Unknown"
            : "Unknown",
          workDate: p.workDate,
          clockIn: p.clockIn,
          clockOut: p.clockOut,
          hoursWorked: p.hoursWorked,
          status: p.status,
          source: p.source,
          locationNames: empLocNames,
        };
      });

      res.json({ punches: data, employees: employeeOptions, locations: locationOptions });
    } catch (error) {
      console.error("Error fetching punches:", error);
      handleRouteError(res, error, "Failed to fetch punches");
    }
  });

  // Directly edit a punch (manager/admin). Recomputes hours via the shared
  // clock-out enforcement and writes an audit entry. No employee notification.
  app.patch(
    "/api/attendance/punches/:id",
    requireAuth,
    requirePermission("attendance.edit"),
    async (req: any, res) => {
      try {
        const actor = req.authUser as User;
        const punchId = String(req.params.id);
        const { clockIn, clockOut, reason } = req.body as {
          clockIn?: string | null;
          clockOut?: string | null;
          reason?: string;
        };

        const existing = await storage.getPunchLog(punchId);
        if (!existing) {
          return res.status(404).json({ message: "Punch not found" });
        }

        const scope = await resolvePunchScope(req);
        if (!scope || !scope.users.some((u) => u.id === existing.employeeId)) {
          return res.status(403).json({ message: "Not authorized to edit this punch" });
        }

        const employeeUser = await storage.getUser(existing.employeeId);
        if (!employeeUser) {
          return res.status(404).json({ message: "Employee not found for this punch" });
        }

        const newClockIn =
          clockIn !== undefined
            ? clockIn
              ? new Date(clockIn)
              : null
            : existing.clockIn
              ? new Date(existing.clockIn)
              : null;
        const newClockOut =
          clockOut !== undefined
            ? clockOut
              ? new Date(clockOut)
              : null
            : existing.clockOut
              ? new Date(existing.clockOut)
              : null;

        // Block edits to a punch already baked into a finalized (exported/locked)
        // payroll batch — changing its hours would silently desync payroll. The
        // manager must reopen the affected batch first.
        const finalizedExports = await findFinalizedPayrollExportsForPunch(punchId);
        if (finalizedExports.length > 0) {
          return res.status(409).json({
            message: `This punch is part of finalized payroll (${describeFinalizedPayroll(finalizedExports)}). Reopen the affected payroll batch before editing the punch.`,
            code: "PAYROLL_FINALIZED",
            payrollExports: finalizedExports.map((e) => ({
              id: e.id,
              startDate: e.startDate,
              endDate: e.endDate,
              status: e.status,
            })),
          });
        }

        const attendancePolicy = await getEffectivePolicy(
          employeeUser.companyId,
          employeeUser.id,
          "attendance",
          employeeUser,
        );
        const payrollPolicy = await getEffectivePolicy(
          employeeUser.companyId,
          employeeUser.id,
          "payroll",
          employeeUser,
        );
        const attRules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
        const payrollRules = payrollPolicy?.rules || DEFAULT_PAYROLL_RULES;
        const roundingRule = attRules.roundingRule ?? DEFAULT_ATTENDANCE_RULES.roundingRule;
        const roundingInterval =
          attRules.roundingIntervalMinutes ?? DEFAULT_ATTENDANCE_RULES.roundingIntervalMinutes;

        // Shared punch-integrity validation: reject impossible/unparseable times,
        // zero/negative duration, future-dating, duplicate open shift, or an
        // overlap with another of this employee's punches.
        const integrity = await validateProposedPunch({
          employeeId: existing.employeeId,
          clockIn: newClockIn,
          clockOut: newClockOut,
          punchId,
          candidateDates: [
            existing.workDate,
            newClockIn ? newClockIn.toISOString().split("T")[0] : undefined,
          ],
          allowFuturePunch: allowFuturePunchFromRules(attRules),
          timezone: await resolveEmployeeTimezone(existing.employeeId),
        });
        if (!integrity.ok) {
          return res.status(400).json({ message: integrity.reason });
        }
        // The validator guarantees a non-null, valid clock-in once we get here;
        // narrow the type for the rounding/enforcement code below.
        if (!newClockIn) {
          return res.status(400).json({ message: "A punch must have a clock-in time." });
        }

        const update: Partial<InsertPunchLog> = {
          clockIn: newClockIn,
          roundedClockIn: roundTime(newClockIn, roundingRule, roundingInterval),
        };

        if (newClockOut) {
          const enforcement = enforceClockOut(
            new Date(update.roundedClockIn!),
            newClockOut,
            existing.breakMinutes || 0,
            attRules,
            payrollRules,
            employeeUser,
            attendancePolicy?.policyName,
          );
          update.clockOut = newClockOut;
          update.roundedClockOut = enforcement.roundedTime;
          update.hoursWorked = enforcement.hoursWorked;
          update.status = enforcement.status;
        } else {
          // Re-opened punch: clear the clock-out side (matches a fresh clock-in).
          update.clockOut = null;
          update.roundedClockOut = null;
          update.hoursWorked = null;
          update.status = "in-progress";
        }

        const oldValue = {
          clockIn: existing.clockIn,
          clockOut: existing.clockOut,
          hoursWorked: existing.hoursWorked,
          status: existing.status,
        };
        const updated = await storage.updatePunchLog(punchId, update);

        await writeAuditLog({
          actorUserId: actor.id,
          targetType: "punch_log",
          targetId: punchId,
          action: "punch_log.edited",
          oldValue,
          newValue: {
            clockIn: updated?.clockIn,
            clockOut: updated?.clockOut,
            hoursWorked: updated?.hoursWorked,
            status: updated?.status,
          },
          context: { reason: reason || null, direct: true, employeeId: existing.employeeId },
          ...getAuditContext(req),
        });

        // Keep the canonical attendance ledger warm for the affected day(s).
        await recomputeLedger(
          existing.employeeId,
          [existing.workDate, updated?.workDate].filter((d): d is string => !!d),
        );

        await writeLedgerEntry({
          category: "attendance",
          eventType: "punch_edit",
          employeeId: existing.employeeId,
          actorUserId: actor.id,
          entityType: "punch_log",
          entityId: punchId,
          workDate: updated?.workDate ?? existing.workDate,
          hoursDelta: hoursDelta(existing.hoursWorked, updated?.hoursWorked),
          beforeValue: oldValue,
          afterValue: {
            clockIn: updated?.clockIn,
            clockOut: updated?.clockOut,
            hoursWorked: updated?.hoursWorked,
            status: updated?.status,
          },
          context: { reason: reason || null, direct: true },
          source: "manager",
          ...getLedgerContext(req),
        });

        res.json(punchLogToApiResponse(updated));
      } catch (error) {
        console.error("Error editing punch:", error);
        handleRouteError(res, error, "Failed to edit punch");
      }
    },
  );

  // Directly delete a punch (manager/admin). Blocks deletes tied to finalized
  // payroll, clears nullable FK references, and writes an audit entry. No
  // employee notification. Idempotent if the punch is already gone.
  app.delete(
    "/api/attendance/punches/:id",
    requireAuth,
    requirePermission("attendance.delete"),
    async (req: any, res) => {
      try {
        const actor = req.authUser as User;
        const punchId = String(req.params.id);
        const reason = typeof req.body?.reason === "string" ? req.body.reason : null;

        const existing = await storage.getPunchLog(punchId);
        if (!existing) {
          return res.json({ deleted: false, alreadyGone: true });
        }

        const scope = await resolvePunchScope(req);
        if (!scope || !scope.users.some((u) => u.id === existing.employeeId)) {
          return res.status(403).json({ message: "Not authorized to delete this punch" });
        }

        const finalizedExports = await findFinalizedPayrollExportsForPunch(punchId);
        if (finalizedExports.length > 0) {
          return res.status(409).json({
            message: `This punch is part of finalized payroll (${describeFinalizedPayroll(finalizedExports)}). Reopen the affected payroll batch before deleting the punch.`,
            code: "PAYROLL_FINALIZED",
            payrollExports: finalizedExports.map((e) => ({
              id: e.id,
              startDate: e.startDate,
              endDate: e.endDate,
              status: e.status,
            })),
          });
        }

        const deleted = await storage.deletePunchLog(punchId);
        if (!deleted) {
          return res.json({ deleted: false, alreadyGone: true });
        }

        await writeAuditLog({
          actorUserId: actor.id,
          targetType: "punch_log",
          targetId: punchId,
          action: "punch_log.deleted",
          oldValue: {
            clockIn: deleted.clockIn,
            clockOut: deleted.clockOut,
            hoursWorked: deleted.hoursWorked,
            workDate: deleted.workDate,
            status: deleted.status,
          },
          newValue: null,
          context: { reason, direct: true, employeeId: deleted.employeeId },
          ...getAuditContext(req),
        });

        // Keep the canonical attendance ledger warm for the deleted punch's day.
        await recomputeLedger(deleted.employeeId, [deleted.workDate]);

        await writeLedgerEntry({
          category: "attendance",
          eventType: "punch_delete",
          employeeId: deleted.employeeId,
          actorUserId: actor.id,
          entityType: "punch_log",
          entityId: punchId,
          workDate: deleted.workDate,
          hoursDelta: hoursDelta(deleted.hoursWorked, null),
          beforeValue: {
            clockIn: deleted.clockIn,
            clockOut: deleted.clockOut,
            hoursWorked: deleted.hoursWorked,
            workDate: deleted.workDate,
            status: deleted.status,
          },
          afterValue: null,
          context: { reason, direct: true },
          source: "manager",
          ...getLedgerContext(req),
        });

        res.json({ deleted: true });
      } catch (error) {
        console.error("Error deleting punch:", error);
        handleRouteError(res, error, "Failed to delete punch");
      }
    },
  );

  app.get("/api/attendance/timesheet/:employeeId", requireAuth, async (req: any, res) => {
    try {
      const requester = req.authUser as User;
      const { employeeId } = req.params;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required (YYYY-MM-DD)." });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ message: "Dates must be in YYYY-MM-DD format." });
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "startDate must be on or before endDate." });
      }

      // Permissions: employees can only view their own; managers see their team; admins see anyone.
      if (employeeId !== requester.id) {
        if (requester.role !== "admin" && requester.role !== "manager") {
          return res.status(403).json({ message: "Not authorized to view this timesheet." });
        }
        const teamIds = await getTeamUserIds(requester);
        if (!teamIds.has(employeeId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's timesheet." });
        }
      }

      const target = await storage.getUser(employeeId);
      if (!target) {
        return res.status(404).json({ message: "Employee not found." });
      }
      if (target.id === SUPER_ADMIN_USER_ID && requester.id !== SUPER_ADMIN_USER_ID) {
        return res.status(404).json({ message: "Employee not found." });
      }

      const result = await buildEmployeeTimesheet(target, startDate, endDate);

      res.json({
        employeeId,
        employeeName: `${target.firstName || ""} ${target.lastName || ""}`.trim() || "Unknown",
        startDate,
        endDate,
        otThresholdDaily: result.otThresholdDaily,
        entries: result.entries,
        totals: result.totals,
      });
    } catch (error) {
      console.error("Error fetching employee timesheet:", error);
      handleRouteError(res, error, "Failed to fetch employee timesheet");
    }
  });

  app.get("/api/timesheet/eligible-employees", requireAuth, async (req: any, res) => {
    try {
      const requester = req.authUser as User;
      if (requester.role !== "admin" && requester.role !== "manager") {
        return res.json([]);
      }
      const teamIds = await getTeamUserIds(requester);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const visible = allUsers
        .filter(u => teamIds.has(u.id) || u.id === requester.id)
        .map(u => ({
          id: u.id,
          firstName: u.firstName || "",
          lastName: u.lastName || "",
          departmentId: u.departmentId || null,
        }))
        .sort((a, b) => {
          const an = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
          const bn = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
          return an.localeCompare(bn);
        });
      res.json(visible);
    } catch (error) {
      console.error("Error fetching timesheet-eligible employees:", error);
      handleRouteError(res, error, "Failed to fetch eligible employees");
    }
  });

  app.post("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const { exceptionDate, exceptionTime, type, reason, punchLogId } = req.body;

      if (!exceptionDate || !type || !reason) {
        return res.status(400).json({ message: "Date, type, and reason are required" });
      }

      const validTypes = ["missing_punch", "time_correction", "forgotten_clock_in", "forgotten_clock_out", "punch_removal"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      // When a punchLogId is provided, validate it points at one of this
      // employee's punches on the same date. The same column doubles as the
      // submission-time target (so the resolve handler can update the right
      // punch on multi-punch days) and as the post-resolve link.
      let resolvedPunchLogId: string | null = null;
      if (typeof punchLogId === "string" && punchLogId.length > 0) {
        const punchLog = await storage.getPunchLog(punchLogId);
        if (!punchLog || punchLog.employeeId !== userId) {
          return res.status(400).json({ message: "Invalid punch reference" });
        }
        if (punchLog.workDate !== exceptionDate) {
          return res.status(400).json({ message: "Punch reference does not match the request date" });
        }
        resolvedPunchLogId = punchLogId;
      }

      // A removal request must target a specific, employee-owned punch — you
      // can't remove a punch that isn't referenced.
      if (type === "punch_removal" && !resolvedPunchLogId) {
        return res.status(400).json({ message: "A punch removal request must reference a valid punch to remove" });
      }

      const auditCtx = getAuditContext(req);

      const result = await db.transaction(async (tx) => {
        // Lock check: if the latest resolved exception on this date does not
        // have a granted-but-unused reopen, block any new submission.
        const [latestResolved] = await tx.select().from(attendanceExceptions)
          .where(and(
            eq(attendanceExceptions.employeeId, userId),
            eq(attendanceExceptions.exceptionDate, exceptionDate),
            inArray(attendanceExceptions.status, ["approved", "denied", "cancelled"]),
          ))
          .orderBy(desc(attendanceExceptions.createdAt))
          .limit(1);

        if (latestResolved) {
          const hasUnusedReopen =
            latestResolved.reopenStatus === "granted" && !latestResolved.reopenConsumedAt;

          // A genuinely open punch (has a clock-in, no clock-out) can still
          // receive its missing clock-out even after a prior correction on this
          // date was resolved — e.g. an approved missing-clock-in correction
          // leaves the punch open. Adding the clock-out is a NEW, non-overlapping
          // fix, not a re-litigation of the prior decision, so the date lock must
          // not block it. (Re-editing the prior approval still goes via reopen.)
          let allowOpenPunchClockOut = false;
          if (type === "forgotten_clock_out" && resolvedPunchLogId) {
            const [targetPunch] = await tx.select().from(punchLogs)
              .where(and(
                eq(punchLogs.id, resolvedPunchLogId),
                eq(punchLogs.employeeId, userId),
              ))
              .limit(1);
            if (targetPunch && targetPunch.clockIn && !targetPunch.clockOut) {
              allowOpenPunchClockOut = true;
            }
          }

          if (!hasUnusedReopen && !allowOpenPunchClockOut) {
            const verdict = latestResolved.status.charAt(0).toUpperCase() + latestResolved.status.slice(1);
            return {
              error: {
                status: 409,
                message: `A previous correction request for this date was already ${verdict.toLowerCase()}. Ask an admin to reopen it before submitting a new one.`,
              },
            } as const;
          }
        }

        // Duplicate-prevention: a second pending request is blocked for the same
        // punch (when punchLogId is provided) or for the same date when no punch
        // is linked. Sibling rows on the same date may still submit their own
        // request because each has its own punchLogId.
        const existingPending = await tx.select().from(attendanceExceptions)
          .where(and(
            eq(attendanceExceptions.employeeId, userId),
            eq(attendanceExceptions.exceptionDate, exceptionDate),
            eq(attendanceExceptions.status, "pending"),
          ));
        const duplicate = existingPending.find(ex => {
          if (resolvedPunchLogId) return ex.punchLogId === resolvedPunchLogId;
          return ex.punchLogId === null;
        });
        if (duplicate) {
          return {
            error: {
              status: 409,
              message: resolvedPunchLogId
                ? "A correction request for this punch is already pending review."
                : "A correction request for this date is already pending review.",
            },
          } as const;
        }

        const [created] = await tx.insert(attendanceExceptions).values({
          employeeId: userId,
          exceptionDate,
          exceptionTime: exceptionTime ? new Date(exceptionTime) : null,
          type,
          reason,
          status: "pending",
          punchLogId: resolvedPunchLogId,
        }).returning();

        if (latestResolved && latestResolved.reopenStatus === "granted" && !latestResolved.reopenConsumedAt) {
          const consumedAt = new Date();
          await tx.update(attendanceExceptions)
            .set({ reopenConsumedAt: consumedAt })
            .where(eq(attendanceExceptions.id, latestResolved.id));

          await writeAuditLog({
            actorUserId: userId,
            targetType: "attendance_exception",
            targetId: latestResolved.id,
            action: "exception.reopen.consumed",
            oldValue: { reopenConsumedAt: null },
            newValue: { reopenConsumedAt: consumedAt, supersededByExceptionId: created.id },
            context: { newExceptionId: created.id },
            ...auditCtx,
          }, tx);
        }

        await writeLedgerEntry({
          category: "attendance",
          eventType: "correction_requested",
          employeeId: userId,
          actorUserId: userId,
          entityType: "attendance_exception",
          entityId: created.id,
          workDate: exceptionDate,
          beforeValue: null,
          afterValue: { type, status: "pending", punchLogId: resolvedPunchLogId },
          context: { reason, type },
          ...getLedgerContext(req),
        }, tx);

        return { exception: created } as const;
      });

      if ("error" in result && result.error) {
        return res.status(result.error.status).json({ message: result.error.message });
      }

      const exception = result.exception!;

      runWorkflowsForTrigger({
        userId,
        user: req.authUser,
        triggerType: "attendance_exception",
        data: { type, exceptionDate, exceptionId: exception.id },
      }).catch(err => console.error("Workflow trigger error:", err));

      res.status(201).json(exception);
    } catch (error) {
      console.error("Error creating attendance exception:", error);
      handleRouteError(res, error, "Failed to create attendance exception");
    }
  });

  app.patch("/api/attendance/exceptions/:id", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = String(req.params.id) as string;
      const { exceptionDate, exceptionTime, type, reason, punchLogId } = req.body;

      const existing = await storage.getAttendanceException(exceptionId);
      if (!existing) {
        return res.status(404).json({ message: "Correction request not found" });
      }
      if (existing.employeeId !== userId) {
        return res.status(403).json({ message: "You can only edit your own correction requests" });
      }
      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Only pending requests can be edited" });
      }

      if (!exceptionDate || !type || !reason) {
        return res.status(400).json({ message: "Date, type, and reason are required" });
      }

      const validTypes = ["missing_punch", "time_correction", "forgotten_clock_in", "forgotten_clock_out", "punch_removal"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      // If the client supplies a punchLogId on edit, validate it the same way
      // the POST does. Treating an explicit `null`/empty string as "clear the
      // target" lets the UI move a request from a punch-targeted type back to
      // e.g. missing_punch if the employee changed their mind.
      const updateData: Partial<AttendanceException> = {
        exceptionDate,
        exceptionTime: exceptionTime ? new Date(exceptionTime) : null,
        type,
        reason,
      };
      if (punchLogId !== undefined) {
        if (punchLogId === null || punchLogId === "") {
          updateData.punchLogId = null;
        } else {
          const punchLog = await storage.getPunchLog(punchLogId);
          if (!punchLog || punchLog.employeeId !== userId) {
            return res.status(400).json({ message: "Invalid punch reference" });
          }
          if (punchLog.workDate !== exceptionDate) {
            return res.status(400).json({ message: "Punch reference does not match the request date" });
          }
          updateData.punchLogId = punchLog.id;
        }
      }

      // A punch_removal must always target a punch. Block an edit that would
      // leave it without one (whether explicitly cleared above or never set).
      if (type === "punch_removal") {
        const effectivePunchLogId =
          updateData.punchLogId !== undefined ? updateData.punchLogId : existing.punchLogId;
        if (!effectivePunchLogId) {
          return res.status(400).json({ message: "A punch removal request must target a punch." });
        }
      }

      const updated = await storage.updateAttendanceException(exceptionId, updateData, { expectedStatus: "pending" });

      if (!updated) {
        return res.status(409).json({ message: "This was already handled by someone else." });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating attendance exception:", error);
      handleRouteError(res, error, "Failed to update attendance exception");
    }
  });

  app.post("/api/attendance/exceptions/:id/cancel", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = String(req.params.id) as string;

      const existing = await storage.getAttendanceException(exceptionId);
      if (!existing) {
        return res.status(404).json({ message: "Correction request not found" });
      }
      if (existing.employeeId !== userId) {
        return res.status(403).json({ message: "You can only cancel your own correction requests" });
      }
      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Only pending requests can be cancelled" });
      }

      const updated = await storage.updateAttendanceException(exceptionId, {
        status: "cancelled",
      }, { expectedStatus: "pending" });

      if (!updated) {
        return res.status(409).json({ message: "This was already handled by someone else." });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error cancelling attendance exception:", error);
      handleRouteError(res, error, "Failed to cancel attendance exception");
    }
  });

  app.post("/api/attendance/exceptions/:id/reopen-request", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = String(req.params.id) as string;
      const messageRaw = typeof req.body?.message === "string" ? req.body.message.trim() : "";

      if (!messageRaw) {
        return res.status(400).json({ message: "Please include a short message explaining why you'd like this reopened." });
      }
      if (messageRaw.length > 1000) {
        return res.status(400).json({ message: "Reopen message must be 1000 characters or fewer." });
      }

      const existing = await storage.getAttendanceException(exceptionId);
      if (!existing) {
        return res.status(404).json({ message: "Correction request not found" });
      }
      if (existing.employeeId !== userId) {
        return res.status(403).json({ message: "You can only request a reopen on your own correction requests" });
      }
      if (!["approved", "denied", "cancelled"].includes(existing.status)) {
        return res.status(400).json({ message: "Only resolved correction requests can be reopened" });
      }
      if (existing.reopenStatus === "pending") {
        return res.status(400).json({ message: "A reopen request is already pending review for this correction." });
      }
      if (existing.reopenStatus === "granted" && !existing.reopenConsumedAt) {
        return res.status(400).json({ message: "A reopen has already been granted — submit a new correction request for this date instead." });
      }
      if (existing.reopenStatus === "declined") {
        return res.status(400).json({ message: "An admin has already declined a reopen for this correction." });
      }

      const auditCtx = getAuditContext(req);
      const requestedAt = new Date();

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(attendanceExceptions).set({
          reopenRequestedBy: userId,
          reopenRequestedAt: requestedAt,
          reopenMessage: messageRaw,
          reopenStatus: "pending",
          reopenDecidedBy: null,
          reopenDecidedAt: null,
          reopenDecisionNote: null,
          reopenConsumedAt: null,
        }).where(eq(attendanceExceptions.id, exceptionId)).returning();

        await writeAuditLog({
          actorUserId: userId,
          targetType: "attendance_exception",
          targetId: exceptionId,
          action: "exception.reopen.requested",
          oldValue: { reopenStatus: existing.reopenStatus ?? null },
          newValue: { reopenStatus: "pending", reopenMessage: messageRaw },
          context: { exceptionDate: existing.exceptionDate, originalStatus: existing.status },
          ...auditCtx,
        }, tx);

        return row;
      });

      res.json(updated);
    } catch (error) {
      console.error("Error requesting reopen:", error);
      handleRouteError(res, error, "Failed to submit reopen request");
    }
  });

  app.post("/api/attendance/exceptions/:id/reopen-decide", requireAuth, requirePermission("attendance.approve_corrections"), async (req: any, res) => {
    try {
      const reviewer = req.authUser as User;
      const exceptionId = String(req.params.id) as string;
      const action = req.body?.action;
      const decisionNoteRaw = typeof req.body?.decisionNote === "string" ? req.body.decisionNote.trim() : "";

      if (action !== "grant" && action !== "decline") {
        return res.status(400).json({ message: "action must be 'grant' or 'decline'" });
      }
      if (decisionNoteRaw.length > 1000) {
        return res.status(400).json({ message: "Decision note must be 1000 characters or fewer." });
      }

      const existing = await storage.getAttendanceException(exceptionId);
      if (!existing) {
        return res.status(404).json({ message: "Correction request not found" });
      }
      if (existing.reopenStatus !== "pending") {
        return res.status(400).json({ message: "There is no pending reopen request to decide on this correction." });
      }

      const teamIds = await getTeamUserIds(reviewer);
      if (!teamIds.has(existing.employeeId)) {
        return res.status(403).json({ message: "Not authorized to decide this reopen" });
      }

      const auditCtx = getAuditContext(req);
      const decidedAt = new Date();
      const newStatus = action === "grant" ? "granted" : "declined";

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(attendanceExceptions).set({
          reopenStatus: newStatus,
          reopenDecidedBy: reviewer.id,
          reopenDecidedAt: decidedAt,
          reopenDecisionNote: decisionNoteRaw || null,
          reopenConsumedAt: null,
        }).where(and(
          eq(attendanceExceptions.id, exceptionId),
          eq(attendanceExceptions.reopenStatus, "pending"),
        )).returning();

        if (!row) {
          throw new RouteConflictError("This reopen request was already decided by someone else.");
        }

        await writeAuditLog({
          actorUserId: reviewer.id,
          targetType: "attendance_exception",
          targetId: exceptionId,
          action: action === "grant" ? "exception.reopen.granted" : "exception.reopen.declined",
          oldValue: { reopenStatus: "pending" },
          newValue: { reopenStatus: newStatus, reopenDecisionNote: decisionNoteRaw || null },
          context: {
            exceptionDate: existing.exceptionDate,
            originalStatus: existing.status,
            employeeId: existing.employeeId,
          },
          ...auditCtx,
        }, tx);

        return row;
      });

      res.json(updated);
    } catch (error) {
      console.error("Error deciding reopen:", error);
      handleRouteError(res, error, "Failed to decide reopen request");
    }
  });

  // Enrich an exception list with the originating kiosk name (when the
  // exception was raised against a kiosk punch). Batched: one device map
  // lookup per request rather than per row.
  async function attachKioskNamesToExceptions<T extends { punchLogId?: string | null }>(rows: T[]): Promise<Array<T & { kioskDeviceName: string | null; kiosk: { id: string; name: string } | null }>> {
    const punchIds = Array.from(new Set(rows.map(r => r.punchLogId).filter((x): x is string => !!x)));
    if (punchIds.length === 0) {
      return rows.map(r => ({ ...r, kioskDeviceName: null, kiosk: null }));
    }
    const punches = await Promise.all(punchIds.map(id => storage.getPunchLog(id)));
    const kioskIdByPunch = new Map<string, string>();
    const deviceIds = new Set<string>();
    for (const p of punches) {
      if (p && p.kioskDeviceId) {
        kioskIdByPunch.set(p.id, p.kioskDeviceId);
        deviceIds.add(p.kioskDeviceId);
      }
    }
    const nameByDevice = new Map<string, string>();
    for (const id of Array.from(deviceIds)) {
      const d = await storage.getKioskDevice(id);
      if (d) nameByDevice.set(id, d.name);
    }
    return rows.map(r => {
      const devId = r.punchLogId ? kioskIdByPunch.get(r.punchLogId) : undefined;
      const name = devId ? (nameByDevice.get(devId) ?? null) : null;
      return {
        ...r,
        kioskDeviceName: name,
        kiosk: devId && name ? { id: devId, name } : null,
      };
    });
  }

  // For `punch_overlap` exceptions, load BOTH conflicting punches (the closing
  // punch linked via punchLogId + the conflicting punch whose id is embedded in
  // the reason) so the manager review queue can show them side-by-side and let a
  // manager edit/delete either one. Times are returned as ISO strings plus the
  // employee's business timezone so the client can render in local/business time.
  async function attachOverlapPunchesToExceptions<
    T extends { id: string; type: string; employeeId: string; punchLogId?: string | null; reason?: string | null },
  >(rows: T[]): Promise<Array<T & { overlapPunches?: OverlapPunchPair | null }>> {
    const overlapRows = rows.filter(r => r.type === "punch_overlap");
    if (overlapRows.length === 0) {
      return rows.map(r => ({ ...r, overlapPunches: null }));
    }
    // Collect every punch id we need to load (closing + conflicting), de-duped.
    const punchIds = new Set<string>();
    for (const r of overlapRows) {
      if (r.punchLogId) punchIds.add(r.punchLogId);
      const conflictId = parseConflictingPunchId(r.reason);
      if (conflictId) punchIds.add(conflictId);
    }
    const punchById = new Map<string, PunchLog>();
    await Promise.all(
      Array.from(punchIds).map(async id => {
        const p = await storage.getPunchLog(id);
        if (p) punchById.set(id, p);
      }),
    );
    // Resolve each distinct employee's business timezone once.
    const tzByEmployee = new Map<string, string>();
    await Promise.all(
      Array.from(new Set(overlapRows.map(r => r.employeeId))).map(async empId => {
        tzByEmployee.set(empId, await resolveEmployeeTimezone(empId));
      }),
    );
    const toSummary = (id: string | null | undefined): OverlapPunchSummary | null => {
      if (!id) return null;
      const p = punchById.get(id);
      if (!p) return null;
      return {
        id: p.id,
        clockIn: p.clockIn ? new Date(p.clockIn).toISOString() : null,
        clockOut: p.clockOut ? new Date(p.clockOut).toISOString() : null,
      };
    };
    return rows.map(r => {
      if (r.type !== "punch_overlap") return { ...r, overlapPunches: null };
      const conflictId = parseConflictingPunchId(r.reason);
      return {
        ...r,
        overlapPunches: {
          timezone: tzByEmployee.get(r.employeeId) ?? "America/New_York",
          closing: toSummary(r.punchLogId),
          conflicting: toSummary(conflictId),
        },
      };
    });
  }

  app.get("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;

      if (user.role === "admin" || user.role === "manager") {
        const pagination = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
        // Legacy (no pagination params) callers get a bounded array; paginated
        // callers get the { data, total } envelope. Either way the response is
        // capped so the admin list can't grow unboundedly.
        const { rows, total } = pagination.paginated
          ? await storage.getAttendanceExceptionsPage({ limit: pagination.limit, offset: pagination.offset })
          : await storage.getAttendanceExceptionsPage({ limit: EXCEPTIONS_DIRECTORY_MAX, offset: 0 });

        const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
        const userMap = new Map(allUsers.map(u => [u.id, u]));
        // Only enrich the page we're returning, not the whole table.
        const employeeIds = Array.from(new Set(rows.map(e => e.employeeId)));
        const payPeriodTypeByEmployee = await buildPayPeriodTypeMap(employeeIds, userMap);
        const counts = await storage.getCorrectionRequestCountsBulk(employeeIds, {
          payPeriodTypeByEmployee,
        });
        const allDepartments = await storage.getAllDepartments();
        const deptMap = new Map(allDepartments.map(d => [d.id, d]));
        const allLocations = await storage.getAllLocations();
        const locMap = new Map(allLocations.map(l => [l.id, l]));
        const enriched = rows.map(e => {
          const summary = counts.get(e.employeeId) || emptyCorrectionCountSummary();
          const u = userMap.get(e.employeeId);
          const display = resolveMembershipDisplay(u, deptMap, locMap, null);
          return {
            ...e,
            employeeName: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown",
            departmentName: display.departmentName,
            locationName: display.locationName,
            correctionCounts: summary,
            correctionCount90d: summary,
          };
        });
        const withKiosk = await attachOverlapPunchesToExceptions(await attachGeofenceMapToExceptions(await attachKioskNamesToExceptions(enriched)));
        if (pagination.paginated) {
          return res.json({ data: withKiosk, total, limit: pagination.limit, offset: pagination.offset });
        }
        return res.json(withKiosk);
      }

      const exceptions = await storage.getAttendanceExceptionsByEmployee(userId);
      res.json(await attachOverlapPunchesToExceptions(await attachGeofenceMapToExceptions(await attachKioskNamesToExceptions(exceptions))));
    } catch (error) {
      console.error("Error fetching attendance exceptions:", error);
      handleRouteError(res, error, "Failed to fetch attendance exceptions");
    }
  });

  // Always self-scoped: returns only the logged-in user's own exceptions,
  // regardless of role. Powers the personal "My Correction Requests" card on
  // My Attendance so admins/managers don't see the system-wide list there.
  app.get("/api/attendance/exceptions/my", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptions = await storage.getAttendanceExceptionsByEmployee(userId);
      res.json(await attachKioskNamesToExceptions(exceptions));
    } catch (error) {
      console.error("Error fetching own attendance exceptions:", error);
      handleRouteError(res, error, "Failed to fetch attendance exceptions");
    }
  });

  app.get("/api/attendance/exceptions/correction-counts/me", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id as string;
      const user = req.authUser as User;
      const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : undefined;
      const payPeriodType = await resolvePayPeriodTypeForUser(user);
      const summary = await storage.getCorrectionRequestCounts(userId, {
        excludeId,
        payPeriodType,
      });
      res.json(summary);
    } catch (error) {
      console.error("Error fetching self correction counts:", error);
      handleRouteError(res, error, "Failed to fetch correction counts");
    }
  });

  app.get(
    "/api/attendance/exceptions/correction-counts/:employeeId",
    requireAuth,
    requirePermission("attendance.approve_corrections"),
    async (req: any, res) => {
      try {
        const reviewer = req.authUser as User;
        const employeeId = String(req.params.employeeId) as string;
        const teamIds = await getTeamUserIds(reviewer);
        if (employeeId !== reviewer.id && !teamIds.has(employeeId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's counts" });
        }
        const employee = await storage.getUser(employeeId);
        const payPeriodType = await resolvePayPeriodTypeForUser(employee || reviewer);
        const summary = await storage.getCorrectionRequestCounts(employeeId, { payPeriodType });
        res.json(summary);
      } catch (error) {
        console.error("Error fetching correction counts:", error);
        handleRouteError(res, error, "Failed to fetch correction counts");
      }
    }
  );

  app.get("/api/attendance/exceptions/pending", requireAuth, requirePermission("attendance.approve_corrections"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const teamIds = await getTeamUserIds(user);
      const pending = await storage.getPendingAttendanceExceptions();
      const scopedPending = pending.filter(e => teamIds.has(e.employeeId));
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const isRequesterAdmin = user.role === "admin";
      const employeeIdsForCounts = Array.from(new Set(scopedPending.map(e => e.employeeId)));
      const payPeriodTypeByEmployee = await buildPayPeriodTypeMap(employeeIdsForCounts, userMap);
      const correctionCounts = await storage.getCorrectionRequestCountsBulk(employeeIdsForCounts, {
        payPeriodTypeByEmployee,
      });
      let deptMap = new Map<string, Department>();
      let locMap = new Map<string, Location>();
      let deptManagerMap = new Map<string, string[]>();
      if (isRequesterAdmin) {
        const allDepartments = await storage.getAllDepartments();
        deptMap = new Map(allDepartments.map(d => [d.id, d]));
        const allLocations = await storage.getAllLocations();
        locMap = new Map(allLocations.map(l => [l.id, l]));
        deptManagerMap = await buildDeptManagerNameMap(userMap);
      }
      const enriched = scopedPending.map(e => {
        const u = userMap.get(e.employeeId);
        const summary = correctionCounts.get(e.employeeId) || emptyCorrectionCountSummary();
        const base = {
          ...e,
          employeeName: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown",
          correctionCounts: summary,
          correctionCount90d: summary,
        };
        if (!isRequesterAdmin) return base;
        const display = resolveMembershipDisplay(u, deptMap, locMap, deptManagerMap);
        return {
          ...base,
          departmentId: display.departmentId,
          locationId: display.locationId,
          departmentName: display.departmentName || "Unassigned",
          locationName: display.locationName || "Unassigned",
          managerNames: display.managerNames,
        };
      });
      res.json(await attachOverlapPunchesToExceptions(await attachGeofenceMapToExceptions(await attachKioskNamesToExceptions(enriched))));
    } catch (error) {
      console.error("Error fetching pending exceptions:", error);
      handleRouteError(res, error, "Failed to fetch pending exceptions");
    }
  });

  app.get("/api/attendance/exceptions/reopen-pending", requireAuth, requirePermission("attendance.approve_corrections"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const teamIds = await getTeamUserIds(user);
      const reopenPending = await storage.getReopenPendingAttendanceExceptions();
      const scoped = reopenPending.filter(e => teamIds.has(e.employeeId));
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const enriched = scoped.map(e => {
        const emp = userMap.get(e.employeeId);
        const reviewer = e.reviewedBy ? userMap.get(e.reviewedBy) : null;
        return {
          ...e,
          employeeName: emp ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim() : "Unknown",
          reviewerName: reviewer ? `${reviewer.firstName || ""} ${reviewer.lastName || ""}`.trim() : "System",
        };
      });
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching reopen-pending exceptions:", error);
      handleRouteError(res, error, "Failed to fetch reopen requests");
    }
  });

  app.get("/api/attendance/exceptions/recent-decided", requireAuth, requirePermission("attendance.approve_corrections"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const isRequesterAdmin = user.role === "admin";
      const teamIds = await getTeamUserIds(user);
      const all = await storage.getAllAttendanceExceptions();
      const decided = all
        .filter(e => e.status !== "pending" && teamIds.has(e.employeeId))
        .sort((a, b) => {
          const dateA = a.reviewedAt ? new Date(a.reviewedAt).getTime() : 0;
          const dateB = b.reviewedAt ? new Date(b.reviewedAt).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 20);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      let deptMap = new Map<string, Department>();
      let locMap = new Map<string, Location>();
      let deptManagerMap = new Map<string, string[]>();
      if (isRequesterAdmin) {
        const allDepartments = await storage.getAllDepartments();
        deptMap = new Map(allDepartments.map(d => [d.id, d]));
        const allLocations = await storage.getAllLocations();
        locMap = new Map(allLocations.map(l => [l.id, l]));
        deptManagerMap = await buildDeptManagerNameMap(userMap);
      }
      const enriched = decided.map(e => {
        const emp = userMap.get(e.employeeId);
        const reviewer = e.reviewedBy ? userMap.get(e.reviewedBy) : null;
        const base = {
          ...e,
          employeeName: emp ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim() : "Unknown",
          reviewerName: reviewer ? `${reviewer.firstName || ""} ${reviewer.lastName || ""}`.trim() : "System",
        };
        if (!isRequesterAdmin) return base;
        const display = resolveMembershipDisplay(emp, deptMap, locMap, deptManagerMap);
        return {
          ...base,
          departmentId: display.departmentId,
          locationId: display.locationId,
          departmentName: display.departmentName || "Unassigned",
          locationName: display.locationName || "Unassigned",
          managerNames: display.managerNames,
        };
      });
      res.json(await attachGeofenceMapToExceptions(await attachKioskNamesToExceptions(enriched)));
    } catch (error) {
      console.error("Error fetching recent decided exceptions:", error);
      handleRouteError(res, error, "Failed to fetch recent decided exceptions");
    }
  });

  const exceptionReviewSchema = z.object({
    action: z.enum(["approve", "deny"]),
    reviewNotes: z.string().optional(),
    correctedTime: z.string().optional(),
    correctedClockIn: z.string().optional(),
    correctedClockOut: z.string().optional(),
  });

  app.post("/api/attendance/exceptions/:id/resolve", requireAuth, requirePermission("attendance.approve_corrections"), async (req: any, res) => {
    try {
      const reviewer = req.authUser as User;
      const exceptionId = String(req.params.id) as string;
      const parsed = exceptionReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid review data", errors: parsed.error.flatten() });
      }

      const exception = await storage.getAttendanceException(exceptionId);
      if (!exception) {
        return res.status(404).json({ message: "Exception not found" });
      }
      if (exception.status !== "pending") {
        return res.status(400).json({ message: "Exception already processed" });
      }

      const teamIds = await getTeamUserIds(reviewer);
      if (!teamIds.has(exception.employeeId)) {
        return res.status(403).json({ message: "Not authorized to resolve this exception" });
      }

      const { action, reviewNotes, correctedTime, correctedClockIn, correctedClockOut } = parsed.data;
      const auditCtx = getAuditContext(req);

      if (action === "deny") {
        const updated = await db.transaction(async (tx) => {
          const [result] = await tx.update(attendanceExceptions).set({
            status: "denied",
            reviewedBy: reviewer.id,
            reviewedAt: new Date(),
            reviewNotes: reviewNotes || null,
          }).where(and(
            eq(attendanceExceptions.id, exceptionId),
            eq(attendanceExceptions.status, "pending"),
          )).returning();

          if (!result) {
            throw new RouteConflictError("This correction was already handled by someone else.");
          }

          await writeAuditLog({
            actorUserId: reviewer.id,
            targetType: "attendance_exception",
            targetId: exceptionId,
            action: "exception.denied",
            oldValue: { status: "pending" },
            newValue: { status: "denied" },
            context: { reviewNotes },
            ...auditCtx,
          }, tx);

          await writeLedgerEntry({
            category: "attendance",
            eventType: "correction_rejected",
            employeeId: exception.employeeId,
            actorUserId: reviewer.id,
            entityType: "attendance_exception",
            entityId: exceptionId,
            workDate: exception.exceptionDate,
            beforeValue: { status: "pending" },
            afterValue: { status: "denied" },
            context: { reviewNotes, type: exception.type },
            source: "manager",
            ...getLedgerContext(req),
          }, tx);

          return result;
        });

        return res.json(updated);
      }

      if (exception.type === "time_correction" && !correctedClockIn && !correctedClockOut && !correctedTime) {
        return res.status(400).json({
          message: "At least one of correctedClockIn or correctedClockOut is required for time_correction exceptions",
          fields: ["correctedClockIn", "correctedClockOut"],
        });
      }

      const correctedTimestamp = correctedTime ? new Date(correctedTime) : exception.exceptionTime;

      // Helper that loads the punch this exception targets. Prefer the FK
      // (`punchLogId`) populated at submission time so the resolve handler
      // operates on the punch the employee actually meant to fix even when
      // there are multiple punches on the same date (e.g. overnight shifts,
      // manual splits). Fall back to the legacy employee+date lookup for
      // older rows that don't yet carry the FK.
      const loadTargetedPunch = async (): Promise<PunchLog | undefined> => {
        if (exception.punchLogId) {
          const [byId] = await db
            .select()
            .from(punchLogs)
            .where(eq(punchLogs.id, exception.punchLogId));
          if (byId && byId.employeeId === exception.employeeId) {
            return byId;
          }
          // Fall through to date-based lookup if the FK target was deleted
          // or somehow points at a different employee — the validations
          // below will flag the resulting state as invalid.
        }
        return storage.getAttendanceForUserOnDate(exception.employeeId, exception.exceptionDate);
      };

      if (exception.type === "forgotten_clock_in" || exception.type === "missing_punch") {
        const existingOpen = await storage.getCurrentAttendance(exception.employeeId);
        if (existingOpen && existingOpen.workDate === exception.exceptionDate) {
          return res.status(400).json({ message: "Employee already has an open punch for this date" });
        }
      } else if (exception.type === "forgotten_clock_out") {
        const targetedRecord = await loadTargetedPunch();
        if (!targetedRecord || !targetedRecord.clockIn || targetedRecord.clockOut) {
          return res.status(400).json({ message: "No open punch record found for this date to close" });
        }
      } else if (exception.type === "time_correction") {
        const targetedRecord = await loadTargetedPunch();
        if (!targetedRecord) {
          return res.status(400).json({ message: "No punch record found for this date to correct" });
        }
      } else if (exception.type === "punch_removal") {
        // Block a removal that would delete a punch already baked into a
        // finalized (exported/locked) payroll batch. Deleting it would desync
        // payroll and otherwise surface a raw FK error. The manager must reopen
        // the affected batch first.
        const targetedRecord = await loadTargetedPunch();
        if (targetedRecord) {
          const finalizedExports = await findFinalizedPayrollExportsForPunch(targetedRecord.id);
          if (finalizedExports.length > 0) {
            return res.status(409).json({
              message: `This punch is part of finalized payroll (${describeFinalizedPayroll(finalizedExports)}). Reopen the affected payroll batch before removing the punch, or the change won't be reflected in payroll.`,
              code: "PAYROLL_FINALIZED",
              payrollExports: finalizedExports.map((e) => ({
                id: e.id,
                startDate: e.startDate,
                endDate: e.endDate,
                status: e.status,
              })),
            });
          }
        }
      }

      const employeeUser = await storage.getUser(exception.employeeId);
      if (!employeeUser) {
        return res.status(404).json({ message: "Employee not found for this exception" });
      }
      const exceptionAttendancePolicy = await getEffectivePolicy(
        employeeUser.companyId,
        employeeUser.id,
        "attendance",
        employeeUser,
      );
      const exceptionPayrollPolicy = await getEffectivePolicy(
        employeeUser.companyId,
        employeeUser.id,
        "payroll",
        employeeUser,
      );
      const exceptionAttRules = exceptionAttendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
      const exceptionPayrollRules = exceptionPayrollPolicy?.rules || DEFAULT_PAYROLL_RULES;

      // --- Shared punch-integrity + locked-payroll validation -------------
      // Approving a correction creates/edits a punch on the employee's behalf,
      // so the resulting punch must pass the SAME integrity rules as any other
      // write path (impossible/future/overlapping times) and must not touch a
      // finalized payroll period. punch_removal is handled by its own block
      // above; deny was already returned earlier.
      const correctionAllowFuture = allowFuturePunchFromRules(exceptionAttRules);
      const payrollLockResponse = (exports: PayrollExport[], verb: string) =>
        res.status(409).json({
          message: `This punch is part of finalized payroll (${describeFinalizedPayroll(exports)}). Reopen the affected payroll batch before ${verb}.`,
          code: "PAYROLL_FINALIZED",
          payrollExports: exports.map((e) => ({
            id: e.id,
            startDate: e.startDate,
            endDate: e.endDate,
            status: e.status,
          })),
        });

      if (exception.type === "forgotten_clock_in" || exception.type === "missing_punch") {
        const dateLock = await findFinalizedPayrollExportsForEmployeeDate(
          exception.employeeId,
          exception.exceptionDate,
        );
        if (dateLock.length > 0) {
          return payrollLockResponse(dateLock, "adding this punch");
        }
        const integrity = await validateProposedPunch({
          employeeId: exception.employeeId,
          clockIn: correctedTimestamp || new Date(),
          clockOut: undefined,
          candidateDates: [exception.exceptionDate],
          allowFuturePunch: correctionAllowFuture,
          timezone: await resolveEmployeeTimezone(exception.employeeId),
        });
        if (!integrity.ok) {
          return res.status(400).json({ message: integrity.reason });
        }
      } else if (exception.type === "forgotten_clock_out") {
        const target = await loadTargetedPunch();
        if (target) {
          const punchLock = await findFinalizedPayrollExportsForPunch(target.id);
          if (punchLock.length > 0) {
            return payrollLockResponse(punchLock, "correcting this punch");
          }
          const integrity = await validateProposedPunch({
            employeeId: exception.employeeId,
            clockIn: target.clockIn,
            clockOut: correctedTimestamp || new Date(),
            punchId: target.id,
            candidateDates: [exception.exceptionDate, target.workDate],
            allowFuturePunch: correctionAllowFuture,
            timezone: await resolveEmployeeTimezone(exception.employeeId),
          });
          if (!integrity.ok) {
            return res.status(400).json({ message: integrity.reason });
          }
        }
      } else if (exception.type === "time_correction") {
        const target = await loadTargetedPunch();
        if (target) {
          const punchLock = await findFinalizedPayrollExportsForPunch(target.id);
          if (punchLock.length > 0) {
            return payrollLockResponse(punchLock, "correcting this punch");
          }
          // Derive the punch's proposed final state exactly as the transaction
          // below will (explicit corrected in/out win; otherwise the legacy
          // single `correctedTime` maps to the open side).
          let propClockIn: Date | string | null = target.clockIn;
          let propClockOut: Date | string | null = target.clockOut;
          const explicitIn = correctedClockIn ? new Date(correctedClockIn) : null;
          const explicitOut = correctedClockOut ? new Date(correctedClockOut) : null;
          if (!explicitIn && !explicitOut && correctedTimestamp) {
            if (!target.clockOut) propClockIn = correctedTimestamp;
            else propClockOut = correctedTimestamp;
          } else {
            if (explicitIn) propClockIn = explicitIn;
            if (explicitOut) propClockOut = explicitOut;
          }
          const integrity = await validateProposedPunch({
            employeeId: exception.employeeId,
            clockIn: propClockIn,
            clockOut: propClockOut,
            punchId: target.id,
            candidateDates: [exception.exceptionDate, target.workDate],
            allowFuturePunch: correctionAllowFuture,
            timezone: await resolveEmployeeTimezone(exception.employeeId),
          });
          if (!integrity.ok) {
            return res.status(400).json({ message: integrity.reason });
          }
        }
      }

      // Approving a correction creates or edits a punch on the employee's
      // behalf and tags it as the "manager" method. We intentionally do NOT
      // gate this on the Manager Entry punch-method toggle: that toggle only
      // controls how an EMPLOYEE may self-clock (web/mobile/kiosk/qr). An admin
      // approving a correction the employee requested is an administrative
      // action and must always be allowed, even when the employee's attendance
      // policy has Manager Entry disabled. (Self clock-in/out endpoints still
      // enforce isPunchSourceAllowed for employee-initiated punches.)

      const updated = await db.transaction(async (tx) => {
        let punchLog: PunchLog | undefined | null = null;

        if (exception.type === "forgotten_clock_in" || exception.type === "missing_punch") {
          const [created] = await tx.insert(punchLogs).values({
            employeeId: exception.employeeId,
            workDate: exception.exceptionDate,
            clockIn: correctedTimestamp || new Date(),
            status: "in-progress",
            source: "manager",
            approved: true,
          }).returning();
          punchLog = created;
        } else if (exception.type === "forgotten_clock_out") {
          // Prefer the FK target so multi-punch days resolve unambiguously;
          // fall back to "latest punch on this date" for legacy rows that
          // pre-date the FK column.
          const [latestRecord] = exception.punchLogId
            ? await tx.select().from(punchLogs)
                .where(and(
                  eq(punchLogs.id, exception.punchLogId),
                  eq(punchLogs.employeeId, exception.employeeId),
                ))
                .limit(1)
            : await tx.select().from(punchLogs)
                .where(and(eq(punchLogs.employeeId, exception.employeeId), eq(punchLogs.workDate, exception.exceptionDate)))
                .orderBy(desc(punchLogs.createdAt)).limit(1);
          // The in-transaction lookup MUST agree with the pre-transaction
          // validation above (which rejects a missing or already-closed punch).
          // Previously this block silently fell through when there was nothing
          // open to close, yet the exception was still stamped "approved" below
          // — leaving an Approved correction with NO clock-out written (the punch
          // still nagged "missing clock-out"). Abort loudly instead so the punch
          // and the verdict can never disagree. A null/closed punch here means
          // the state changed between validation and this transaction (race), so
          // a 409 telling the reviewer to refresh is the right outcome.
          if (!latestRecord || !latestRecord.clockIn || latestRecord.clockOut) {
            throw new RouteConflictError(
              "No open punch was found to close for this date — it may have just been corrected or removed. Refresh and try again.",
            );
          }
          const clockOutTime = correctedTimestamp || new Date();
          const roundedClockInTime = new Date(latestRecord.roundedClockIn ?? latestRecord.clockIn);
          const breakMinutes = latestRecord.breakMinutes || 0;

          const enforcement = enforceClockOut(
            roundedClockInTime,
            clockOutTime,
            breakMinutes,
            exceptionAttRules,
            exceptionPayrollRules,
            employeeUser,
            exceptionAttendancePolicy?.policyName,
          );

          const [updated] = await tx.update(punchLogs).set({
            clockOut: clockOutTime,
            roundedClockOut: enforcement.roundedTime,
            hoursWorked: enforcement.hoursWorked,
            status: enforcement.status,
            // A manager resolving an exception is a manager-entry punch.
            source: "manager",
          }).where(eq(punchLogs.id, latestRecord.id)).returning();
          punchLog = updated;
        } else if (exception.type === "time_correction") {
          // Same as forgotten_clock_out: prefer the FK target so the right
          // punch is updated even when an employee has multiple punches on
          // the same date (e.g. an overnight or split shift).
          const [latestRecord] = exception.punchLogId
            ? await tx.select().from(punchLogs)
                .where(and(
                  eq(punchLogs.id, exception.punchLogId),
                  eq(punchLogs.employeeId, exception.employeeId),
                ))
                .limit(1)
            : await tx.select().from(punchLogs)
                .where(and(eq(punchLogs.employeeId, exception.employeeId), eq(punchLogs.workDate, exception.exceptionDate)))
                .orderBy(desc(punchLogs.createdAt)).limit(1);
          if (latestRecord) {
            const oldValue = {
              clockIn: latestRecord.clockIn,
              clockOut: latestRecord.clockOut,
              hoursWorked: latestRecord.hoursWorked,
            };

            const updateData: Partial<InsertPunchLog> = {};
            const newClockIn = correctedClockIn ? new Date(correctedClockIn) : null;
            const newClockOut = correctedClockOut ? new Date(correctedClockOut) : null;

            // Backward-compat: if a caller still sends only the legacy
            // `correctedTime` for a time_correction (pre-task-105 clients),
            // map it to whichever side is missing — clock-in for an open
            // shift, clock-out otherwise.
            if (!newClockIn && !newClockOut && correctedTimestamp) {
              if (!latestRecord.clockOut) {
                updateData.clockIn = correctedTimestamp;
              } else {
                updateData.clockOut = correctedTimestamp;
                const roundedClockInTime = new Date(latestRecord.roundedClockIn ?? latestRecord.clockIn!);
                const enforcement = enforceClockOut(
                  roundedClockInTime,
                  correctedTimestamp,
                  latestRecord.breakMinutes || 0,
                  exceptionAttRules,
                  exceptionPayrollRules,
                  employeeUser,
                  exceptionAttendancePolicy?.policyName,
                );
                updateData.roundedClockOut = enforcement.roundedTime;
                updateData.hoursWorked = enforcement.hoursWorked;
                updateData.status = enforcement.status;
              }
            } else {
              const roundingRule = exceptionAttRules.roundingRule ?? DEFAULT_ATTENDANCE_RULES.roundingRule;
              const roundingInterval = exceptionAttRules.roundingIntervalMinutes ?? DEFAULT_ATTENDANCE_RULES.roundingIntervalMinutes;

              if (newClockIn) {
                updateData.clockIn = newClockIn;
                updateData.roundedClockIn = roundTime(newClockIn, roundingRule, roundingInterval);
              }

              const effectiveRoundedClockIn = updateData.roundedClockIn
                ?? (latestRecord.roundedClockIn ? new Date(latestRecord.roundedClockIn)
                  : (latestRecord.clockIn ? new Date(latestRecord.clockIn) : null));

              if (newClockOut) {
                if (!effectiveRoundedClockIn) {
                  throw new Error("Cannot apply corrected clock-out without a clock-in time");
                }
                const enforcement = enforceClockOut(
                  effectiveRoundedClockIn,
                  newClockOut,
                  latestRecord.breakMinutes || 0,
                  exceptionAttRules,
                  exceptionPayrollRules,
                  employeeUser,
                  exceptionAttendancePolicy?.policyName,
                );
                updateData.clockOut = newClockOut;
                updateData.roundedClockOut = enforcement.roundedTime;
                updateData.hoursWorked = enforcement.hoursWorked;
                updateData.status = enforcement.status;
              } else if (newClockIn && latestRecord.clockOut && effectiveRoundedClockIn) {
                // Clock-in changed but clock-out unchanged — recompute hours
                // against the existing clock-out so the punch stays consistent.
                const enforcement = enforceClockOut(
                  effectiveRoundedClockIn,
                  new Date(latestRecord.clockOut),
                  latestRecord.breakMinutes || 0,
                  exceptionAttRules,
                  exceptionPayrollRules,
                  employeeUser,
                  exceptionAttendancePolicy?.policyName,
                );
                updateData.roundedClockOut = enforcement.roundedTime;
                updateData.hoursWorked = enforcement.hoursWorked;
                updateData.status = enforcement.status;
              }
            }

            // A manager resolving a correction is a manager-entry punch.
            updateData.source = "manager";

            const [corrected] = await tx.update(punchLogs).set(updateData).where(eq(punchLogs.id, latestRecord.id)).returning();
            punchLog = corrected;

            await writeAuditLog({
              actorUserId: reviewer.id,
              targetType: "punch_log",
              targetId: latestRecord.id,
              action: "punch_log.corrected",
              oldValue,
              newValue: {
                clockIn: punchLog?.clockIn,
                clockOut: punchLog?.clockOut,
                hoursWorked: punchLog?.hoursWorked,
              },
              context: { exceptionId, reason: exception.reason },
              ...auditCtx,
            }, tx);
          }
        } else if (exception.type === "punch_removal") {
          // Load the targeted punch strictly by FK — a removal request always
          // carries one (enforced at submission). If it's gone, the punch was
          // already deleted, so treat the request as resolved without 500ing.
          const [target] = exception.punchLogId
            ? await tx.select().from(punchLogs)
                .where(and(
                  eq(punchLogs.id, exception.punchLogId),
                  eq(punchLogs.employeeId, exception.employeeId),
                ))
                .limit(1)
            : [];
          if (target) {
            // Clear every attendance-exception reference to this punch (incl.
            // the one being resolved) so the FK constraint doesn't block the
            // delete. The status-guarded update below re-stamps this exception
            // with a null punch link.
            await tx.update(attendanceExceptions)
              .set({ punchLogId: null })
              .where(eq(attendanceExceptions.punchLogId, target.id));

            // Defense-in-depth against a finalize-then-remove race: the
            // pre-transaction guard already blocks removals tied to finalized
            // payroll, but re-check inside the tx so a batch that was exported
            // between the guard and here still fails loudly instead of via a
            // raw FK error.
            const finalizedExports = await findFinalizedPayrollExportsForPunch(target.id, tx);
            if (finalizedExports.length > 0) {
              throw new PayrollFinalizedError(
                `This punch is part of finalized payroll (${describeFinalizedPayroll(finalizedExports)}). Reopen the affected payroll batch before removing the punch.`,
              );
            }

            // Null the remaining nullable references (draft payroll batch
            // records / adjustments and biometric supervisor overrides) so the
            // FK constraints don't block the delete. Finalized payroll is
            // handled by the guard above.
            await tx.update(payrollBatchRecordsTable)
              .set({ punchLogId: null })
              .where(eq(payrollBatchRecordsTable.punchLogId, target.id));
            await tx.update(payrollAdjustmentsTable)
              .set({ punchLogId: null })
              .where(eq(payrollAdjustmentsTable.punchLogId, target.id));
            await tx.update(biometricSupervisorOverridesTable)
              .set({ punchLogId: null })
              .where(eq(biometricSupervisorOverridesTable.punchLogId, target.id));

            await tx.delete(punchLogs).where(eq(punchLogs.id, target.id));

            await writeAuditLog({
              actorUserId: reviewer.id,
              targetType: "punch_log",
              targetId: target.id,
              action: "punch_log.removed",
              oldValue: {
                clockIn: target.clockIn,
                clockOut: target.clockOut,
                hoursWorked: target.hoursWorked,
                workDate: target.workDate,
                status: target.status,
              },
              newValue: null,
              context: { exceptionId, reason: exception.reason },
              ...auditCtx,
            }, tx);
          }
          // `punchLog` stays null — the punch no longer exists, so the
          // exception is recorded with a null link below.
        }

        const [result] = await tx.update(attendanceExceptions).set({
          status: "approved",
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || null,
          punchLogId: punchLog?.id || null,
        }).where(and(
          eq(attendanceExceptions.id, exceptionId),
          eq(attendanceExceptions.status, "pending"),
        )).returning();

        // A 0-row update means another reviewer resolved this exception while
        // we were building the punch correction above. Throw to roll the whole
        // transaction back (including any punch we just created/updated) so the
        // correction is never applied twice.
        if (!result) {
          throw new RouteConflictError("This correction was already handled by someone else.");
        }

        await writeAuditLog({
          actorUserId: reviewer.id,
          targetType: "attendance_exception",
          targetId: exceptionId,
          action: "exception.approved",
          oldValue: { status: "pending" },
          newValue: { status: "approved", punchLogId: punchLog?.id },
          context: {
            reviewNotes,
            exceptionType: exception.type,
            // The employee's requested values are embedded in `reason`; the
            // approver-supplied (possibly counter-approved) values are captured
            // here so the audit trail shows both requested and approved.
            requested: exception.reason,
            ...(correctedClockIn ? { approvedClockIn: correctedClockIn } : {}),
            ...(correctedClockOut ? { approvedClockOut: correctedClockOut } : {}),
            ...(correctedTime ? { approvedTime: correctedTime } : {}),
          },
          ...auditCtx,
        }, tx);

        await writeLedgerEntry({
          category: "attendance",
          eventType: "correction_approved",
          employeeId: exception.employeeId,
          actorUserId: reviewer.id,
          entityType: "attendance_exception",
          entityId: exceptionId,
          workDate: exception.exceptionDate,
          hoursDelta: punchLog ? hoursDelta(null, punchLog.hoursWorked) : null,
          beforeValue: { status: "pending" },
          afterValue: {
            status: "approved",
            punchLogId: punchLog?.id ?? null,
            ...(punchLog ? { clockIn: punchLog.clockIn, clockOut: punchLog.clockOut, hoursWorked: punchLog.hoursWorked } : {}),
          },
          context: {
            type: exception.type,
            reviewNotes,
            ...(correctedClockIn ? { approvedClockIn: correctedClockIn } : {}),
            ...(correctedClockOut ? { approvedClockOut: correctedClockOut } : {}),
            ...(correctedTime ? { approvedTime: correctedTime } : {}),
          },
          source: "manager",
          ...getLedgerContext(req),
        }, tx);

        return { result, punchLog };
      });

      if (updated.punchLog && (exception.type === "forgotten_clock_out" || exception.type === "time_correction")) {
        await checkPostExportModification(updated.punchLog.id, reviewer.id);
      }

      // A resolved exception may have created/updated/deleted a punch — refresh
      // the canonical ledger for the affected employee-day(s).
      const affectedDates = Array.from(
        new Set([exception.exceptionDate, updated.punchLog?.workDate].filter(Boolean) as string[]),
      );
      void recomputeLedger(exception.employeeId, affectedDates);

      return res.json(updated.result);
    } catch (error) {
      console.error("Error resolving attendance exception:", error);
      handleRouteError(res, error, "Failed to resolve attendance exception");
    }
  });

  app.post("/api/time-off", requireAuth, attachPolicyContext("pto"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const parsed = insertTimeOffRequestSchema.parse({ ...req.body, userId, status: "pending" });

      const startMs = new Date(parsed.startDate + "T00:00:00Z").getTime();
      const endMs = new Date(parsed.endDate + "T00:00:00Z").getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
        return res.status(400).json({ message: "Invalid date range" });
      }
      let computedDays = 0;
      const cur = new Date(startMs);
      while (cur.getTime() <= endMs) {
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) computedDays++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      if (computedDays === 0) {
        return res.status(400).json({ message: "Request must include at least one business day" });
      }
      const computedHours = computedDays * 8;

      const ptoRules = getPolicyRules(req, "pto");

      const empSettings = await storage.getEmployeePtoSettings(userId);
      const legacyPolicy = await storage.getEmployeePtoPolicy(userId);

      const waitingPeriodDays = ptoRules.waitingPeriodDays ?? legacyPolicy?.waitingPeriodDays ?? 0;
      if (empSettings?.hireDate && waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return res.status(400).json({ message: "You are still within the waiting period and cannot request time off yet" });
        }
      }

      const maxConsecutiveHours = ptoRules.maxConsecutiveHours ?? 80;
      const exceedsMaxConsecutive = computedHours > maxConsecutiveHours;

      const advanceCheck = enforcePtoAdvanceNotice(parsed.startDate, ptoRules);
      if (!advanceCheck.allowed) {
        return res.status(400).json({ message: advanceCheck.rejectionMessage });
      }

      const blackoutCheck = enforcePtoBlackoutDates(parsed.startDate, parsed.endDate, ptoRules);
      if (!blackoutCheck.allowed) {
        return res.status(400).json({ message: blackoutCheck.rejectionMessage });
      }

      const overlapping = await storage.getOverlappingTimeOffRequests(userId, parsed.startDate, parsed.endDate);
      if (overlapping.length > 0) {
        const conflict = overlapping[0];
        return res.status(400).json({
          message: `This request overlaps with an existing ${conflict.status} time-off request from ${conflict.startDate} to ${conflict.endDate}. Please choose different dates.`,
        });
      }

      const balance = await storage.computeTimeOffBalance(userId);
      const requestType = parsed.type as string;
      const availableBalance = requestType === "vacation" ? balance.vacation
        : requestType === "sick" ? balance.sick
        : requestType === "personal" ? balance.personal : null;

      const isBalanceTracked = isBalanceTrackedTimeOffType(requestType);
      const exceedsBalance = availableBalance !== null && computedHours > availableBalance;

      // Approval routing:
      //   - When the PTO policy's `requireApproval` toggle is off AND the
      //     request fits within the employee's available balance (for
      //     balance-tracked leave types) AND doesn't exceed the max
      //     consecutive cap, auto-approve on submit.
      //   - A balance-tracked request that exceeds the employee's available
      //     balance ALWAYS routes to manager approval, regardless of the
      //     `requireApproval` toggle. The request is never auto-rejected for
      //     being over balance — it just lands in the pending queue.
      //   - The same over-balance guard must be honored by every other
      //     auto-approve path (see `canAutoApprovePtoRequest` used by
      //     `server/workflowEngine.ts`).
      const requireApprovalPolicy = ptoRules.requireApproval !== false;
      const forceManagerApprovalForOverBalance = isBalanceTracked && exceedsBalance;
      const wouldAutoApprovePerPolicy =
        !requireApprovalPolicy && !exceedsMaxConsecutive;
      const autoApprove =
        wouldAutoApprovePerPolicy && !forceManagerApprovalForOverBalance;
      const overBalanceOverridesAutoApprove =
        forceManagerApprovalForOverBalance && wouldAutoApprovePerPolicy;
      const finalStatus: "pending" | "approved" = autoApprove ? "approved" : "pending";

      const request = await storage.createTimeOffRequest({
        ...parsed,
        status: finalStatus,
        hoursRequested: computedHours,
        hoursApproved: autoApprove ? computedHours : null,
        exceedsBalance,
        balanceAtSubmission: availableBalance ?? null,
        exceedsMaxConsecutive,
        maxConsecutiveAtSubmission: maxConsecutiveHours,
        reviewedBy: autoApprove ? userId : null,
        reviewedAt: autoApprove ? new Date() : null,
      });

      if (overBalanceOverridesAutoApprove) {
        try {
          const auditCtx = getAuditContext(req);
          await writeAuditLog({
            actorUserId: userId,
            targetType: "time_off_request",
            targetId: request.id,
            action: "time_off.over_balance_forced_approval",
            newValue: {
              type: requestType,
              hoursRequested: computedHours,
              availableBalance,
              policyRequireApproval: requireApprovalPolicy,
              reason: "Over-balance PTO request routed to manager approval despite policy auto-approve setting",
            },
            ...auditCtx,
          });
        } catch (auditError) {
          console.error("Failed to write audit log for time_off.over_balance_forced_approval:", auditError);
        }
      }

      runWorkflowsForTrigger({
        userId,
        user: req.authUser,
        triggerType: "pto_request_submitted",
        data: { hoursRequested: computedHours, ptoBalance: availableBalance, requestType, requestId: request.id },
      }).catch(err => console.error("Workflow trigger error:", err));

      res.json(request);
    } catch (error: any) {
      console.error("Error creating time off request:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      handleRouteError(res, error, "Failed to create time off request");
    }
  });

  app.post("/api/time-off/cashout", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const cashoutSchema = z.object({
        type: z.enum(["vacation", "sick", "personal"]),
        hours: z.number().positive().finite().max(9999),
        reason: z.string().max(1000).optional(),
      });

      const parsed = cashoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cash-out request", errors: parsed.error.flatten() });
      }

      const { type, hours, reason } = parsed.data;

      const balance = await storage.computeTimeOffBalance(userId);
      const availableBalance = type === "vacation" ? balance.vacation
        : type === "sick" ? balance.sick
        : type === "personal" ? balance.personal : 0;

      if (hours > availableBalance) {
        return res.status(400).json({
          message: `Insufficient ${type} balance. You have ${availableBalance} hour(s) remaining but requested ${hours} hour(s).`,
        });
      }

      const today = new Date().toISOString().split("T")[0];

      const request = await storage.createTimeOffRequest({
        userId,
        type,
        requestCategory: "cashout",
        startDate: today,
        endDate: today,
        hoursRequested: hours,
        status: "pending",
        reason: reason || `PTO Cash-Out: ${hours} hours`,
        exceedsBalance: false,
        balanceAtSubmission: availableBalance,
      });

      res.json(request);
    } catch (error: any) {
      console.error("Error creating cash-out request:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid cash-out request", errors: error.errors });
      }
      handleRouteError(res, error, "Failed to create cash-out request");
    }
  });

  app.put("/api/time-off/:id", requireAuth, attachPolicyContext("pto"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const requestId = String(req.params.id) as string;

      const existing = await storage.getTimeOffRequest(requestId);
      if (!existing) return res.status(404).json({ message: "Request not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "You can only edit your own requests" });
      if (existing.status !== "pending") return res.status(400).json({ message: "Only pending requests can be edited" });

      const parsed = insertTimeOffRequestSchema.parse({ ...req.body, userId, status: "pending" });

      const startMs = new Date(parsed.startDate + "T00:00:00Z").getTime();
      const endMs = new Date(parsed.endDate + "T00:00:00Z").getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
        return res.status(400).json({ message: "Invalid date range" });
      }
      let computedDays = 0;
      const cur = new Date(startMs);
      while (cur.getTime() <= endMs) {
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) computedDays++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      if (computedDays === 0) {
        return res.status(400).json({ message: "Request must include at least one business day" });
      }
      const computedHours = computedDays * 8;

      const ptoRules = getPolicyRules(req, "pto");

      const empSettings = await storage.getEmployeePtoSettings(userId);
      const legacyPolicy = await storage.getEmployeePtoPolicy(userId);

      const waitingPeriodDays = ptoRules.waitingPeriodDays ?? legacyPolicy?.waitingPeriodDays ?? 0;
      if (empSettings?.hireDate && waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return res.status(400).json({ message: "You are still within the waiting period and cannot request time off yet" });
        }
      }

      const maxConsecutiveHours = ptoRules.maxConsecutiveHours ?? 80;
      const exceedsMaxConsecutive = computedHours > maxConsecutiveHours;

      const advanceCheck = enforcePtoAdvanceNotice(parsed.startDate, ptoRules);
      if (!advanceCheck.allowed) {
        return res.status(400).json({ message: advanceCheck.rejectionMessage });
      }

      const blackoutCheck = enforcePtoBlackoutDates(parsed.startDate, parsed.endDate, ptoRules);
      if (!blackoutCheck.allowed) {
        return res.status(400).json({ message: blackoutCheck.rejectionMessage });
      }

      const balance = await storage.computeTimeOffBalance(userId);
      const requestType = parsed.type as string;
      const availableBalance = requestType === "vacation" ? balance.vacation
        : requestType === "sick" ? balance.sick
        : requestType === "personal" ? balance.personal : null;

      if (availableBalance !== null && computedHours > availableBalance) {
        return res.status(400).json({
          message: `Insufficient ${requestType} balance. You have ${availableBalance} hour(s) remaining but requested ${computedHours}.`,
        });
      }

      const oldValue = {
        type: existing.type,
        startDate: existing.startDate,
        endDate: existing.endDate,
        hoursRequested: existing.hoursRequested,
        reason: existing.reason,
      };

      const updated = await storage.updateTimeOffRequest(requestId, {
        type: parsed.type,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        hoursRequested: computedHours,
        reason: parsed.reason,
        exceedsMaxConsecutive,
        maxConsecutiveAtSubmission: maxConsecutiveHours,
        editedAt: new Date(),
      });

      try {
        const auditCtx = getAuditContext(req);
        await writeAuditLog({
          actorUserId: userId,
          targetType: "time_off_request",
          targetId: requestId,
          action: "time_off.edited",
          oldValue,
          newValue: {
            type: parsed.type,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            hoursRequested: computedHours,
            reason: parsed.reason,
          },
          ...auditCtx,
        });
      } catch (auditError) {
        console.error("Failed to write audit log for time_off.edited:", auditError);
      }

      // Keep the ledger warm for both the old and new covered ranges. Editing is
      // restricted to pending requests today (no approved coverage changes), but
      // recomputing keeps the ledger correct if that ever changes.
      void recomputeLedger(userId, [
        existing.startDate,
        existing.endDate,
        parsed.startDate,
        parsed.endDate,
      ]);

      res.json(updated);
    } catch (error: any) {
      console.error("Error editing time off request:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      handleRouteError(res, error, "Failed to edit time off request");
    }
  });

  app.get("/api/time-off", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const requests = await storage.getTimeOffRequestsByUser(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time off requests:", error);
      handleRouteError(res, error, "Failed to fetch time off requests");
    }
  });

  app.get("/api/time-off/my-balance", requireAuth, async (req: any, res) => {
    try {
      const user = req.authUser as User;
      if (user.role !== "admin") {
        return res.status(403).json({ message: "PTO balances are not available here. Please send a message for any balance inquiry." });
      }
      const balance = await storage.computeTimeOffBalanceDetailed(user.id);
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      handleRouteError(res, error, "Failed to fetch PTO balance");
    }
  });

  app.get("/api/time-off/my-pto-policy-info", requireAuth, async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const policy = await storage.getEmployeePtoPolicy(user.id);
      const settings = await storage.getEmployeePtoSettings(user.id);

      if (!policy) {
        return res.json({ hasPolicy: false });
      }

      const currentYear = new Date().getFullYear();
      let waitingEndIso: string | undefined;
      let waitingPeriod: { active: boolean; daysRemaining?: number; endDate?: string | null } | null = null;

      if (settings?.hireDate && policy.waitingPeriodDays > 0) {
        const hireMs = new Date(settings.hireDate).getTime();
        const waitingEndMs = hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000;
        const waitingEndDate = new Date(waitingEndMs);
        waitingEndIso = `${waitingEndDate.getUTCFullYear()}-${String(waitingEndDate.getUTCMonth() + 1).padStart(2, "0")}-${String(waitingEndDate.getUTCDate()).padStart(2, "0")}`;
        const active = Date.now() < waitingEndMs;
        waitingPeriod = {
          active,
          daysRemaining: active ? Math.ceil((waitingEndMs - Date.now()) / (24 * 60 * 60 * 1000)) : 0,
          endDate: waitingEndIso,
        };
      }

      const yearStart = `${currentYear}-01-01`;
      const fromDate = waitingEndIso && waitingEndIso > yearStart ? waitingEndIso : undefined;
      const hoursWorkedThisYear = await storage.computeTotalHoursWorked(user.id, currentYear, fromDate);

      let earnedThisYear = 0;
      if (policy.accrualType === "per_hours_worked") {
        const threshold = policy.vacationAccrualPerHoursWorked > 0 ? policy.vacationAccrualPerHoursWorked : 30;
        const earnedPer = policy.vacationAccrualHoursPerThreshold ?? 1;
        const accrued = Math.floor(hoursWorkedThisYear / threshold) * earnedPer;
        earnedThisYear = policy.yearlyCapHours != null ? Math.min(accrued, policy.yearlyCapHours) : accrued;
      } else {
        earnedThisYear = policy.accrualHoursPerYear;
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;

      res.json({
        hasPolicy: true,
        policyName: policy.name,
        accrualType: policy.accrualType,
        accrualHoursPerYear: policy.accrualHoursPerYear,
        vacationAccrualPerHoursWorked: policy.vacationAccrualPerHoursWorked,
        vacationAccrualHoursPerThreshold: policy.vacationAccrualHoursPerThreshold,
        yearlyCapHours: policy.yearlyCapHours,
        carryoverCapHours: policy.carryoverCapHours,
        hoursWorkedThisYear: round2(hoursWorkedThisYear),
        earnedThisYear: round2(earnedThisYear),
        hasOverride: settings?.vacationHoursOverride != null,
        vacationHoursOverride: settings?.vacationHoursOverride ?? null,
        waitingPeriod,
      });
    } catch (error) {
      console.error("Error fetching PTO policy info:", error);
      handleRouteError(res, error, "Failed to fetch PTO policy info");
    }
  });

  app.get("/api/time-off/balance", requireAuth, requirePermission("pto.view_team"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const targetUserId = req.query.userId as string || user.id;

      if (targetUserId !== user.id) {
        const teamIds = await getTeamUserIds(user);
        if (!teamIds.has(targetUserId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's balance" });
        }
      }

      const balance = await storage.computeTimeOffBalance(targetUserId);
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      handleRouteError(res, error, "Failed to fetch PTO balance");
    }
  });

  app.get("/api/time-off/team", requireAuth, async (req: any, res) => {
    try {
      const allRequests = await storage.getAllTimeOffRequests();
      const calendarEntries = allRequests
        .filter((r) => r.status === "approved" || r.status === "partially_approved" || r.status === "pending")
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          type: r.type,
          startDate: r.startDate,
          endDate: r.endDate,
          status: r.status,
          hoursRequested: r.hoursRequested,
        }));
      res.json(calendarEntries);
    } catch (error) {
      console.error("Error fetching team time off:", error);
      handleRouteError(res, error, "Failed to fetch team time off");
    }
  });

  app.get("/api/manager/team-stats", requireAuth, requirePermission("attendance.view_team"), requestCache({ scope: "user" }), async (req, res) => {
    const user = (req as any).authUser as User;
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const pendingRequests = await storage.getPendingTimeOffRequests();

    let teamMembers: User[];
    if (user.role === "admin") {
      teamMembers = allUsers.filter(u => u.id !== user.id);
    } else {
      teamMembers = user.departmentId
        ? (await storage.getUsersByDepartment(user.departmentId)).filter(u => u.id !== user.id)
        : [];
    }

    const teamIds = new Set(teamMembers.map(u => u.id));
    const clockedIn = todayAttendance.filter(a => teamIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;

    const allTimeOff = await storage.getAllTimeOffRequests();
    const usingPto = allTimeOff.filter(r =>
      teamIds.has(r.userId) &&
      (r.status === "approved" || r.status === "partially_approved") &&
      r.startDate <= today &&
      (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
    ).length;

    const teamPending = pendingRequests.filter(r => teamIds.has(r.userId)).length;

    res.json({
      teamSize: teamMembers.length,
      clockedIn,
      usingPto,
      pendingApprovals: teamPending,
    });
  });

  app.get("/api/manager/team-status", requireAuth, requirePermission("attendance.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const today = new Date().toISOString().split("T")[0];

    let teamMembers: User[];
    if (user.role === "admin") {
      teamMembers = (await storage.getAllUsers()).filter(u => u.id !== user.id);
    } else {
      teamMembers = user.departmentId
        ? (await storage.getUsersByDepartment(user.departmentId)).filter(u => u.id !== user.id)
        : [];
    }

    const todayAttendance = await storage.getAttendanceByDate(today);
    const allTimeOff = await storage.getAllTimeOffRequests();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekAttendance = await storage.getAttendanceByDateRange(weekStartStr, today);

    const uniqueDeptIds = [...new Set(teamMembers.map(m => m.departmentId).filter(Boolean))] as string[];
    const deptMap = new Map<string, string>();
    await Promise.all(uniqueDeptIds.map(async (deptId) => {
      const dept = await storage.getDepartment(deptId);
      if (dept) deptMap.set(deptId, dept.name);
    }));

    // Today + week hours come from the canonical attendance ledger (the unified
    // pay engine's break-deducted, rounded per-day split) — NOT raw
    // clockOut - clockIn math, which silently disagreed with the timesheet,
    // reports and payroll. One ledger read covers the week; today is the row for
    // the current date.
    const now = new Date();
    const ledgerByMember = await getLedgerForEmployees(teamMembers, weekStartStr, today, now);

    const teamStatus = teamMembers.map(member => {
      const todayRecord = todayAttendance.find(a => a.employeeId === member.id && a.clockIn && !a.clockOut);
      const hasPtoToday = allTimeOff.some(r =>
        r.userId === member.id && (r.status === "approved" || r.status === "partially_approved") && r.startDate <= today && (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
      );

      const memberLedger = ledgerByMember.get(member.id) || [];
      const todayHours = memberLedger.find(d => d.workDate === today)?.totalHours ?? 0;
      const weekHours = summarizeLedger(memberLedger).totalHours;

      let status = "Clocked Out";
      if (todayRecord) {
        const clockInTime = new Date(todayRecord.clockIn!);
        status = `Clocked In (${clockInTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })})`;
      }

      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        departmentName: member.departmentId ? (deptMap.get(member.departmentId) ?? "Unassigned") : "Unassigned",
        status,
        hasPtoToday,
        todayHours: Math.round(todayHours * 10) / 10,
        weekHours: Math.round(weekHours * 10) / 10,
      };
    });

    res.json(teamStatus);
  });

  const approvalSchema = z.object({
    comment: z.string().optional(),
    hoursApproved: z
      .number()
      .finite()
      .positive()
      .max(MAX_TIME_OFF_HOURS_PER_REQUEST)
      .optional(),
    approvedEndDate: z.string().optional(),
  });

  app.post("/api/time-off/:id/approve", requireAuth, requirePermission("pto.approve"), async (req, res) => {
    try {
      const user = (req as any).authUser as User;
      const parsed = approvalSchema.safeParse(req.body);
      if (!parsed.success) return badRequestFromZod(res, parsed, "Invalid approval request");
      const { comment, hoursApproved, approvedEndDate } = parsed.data;
      const requestId = String(req.params.id) as string;
      const request = await storage.getTimeOffRequest(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

      const teamIds = await getTeamUserIds(user);
      if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to approve this request" });

      if (hoursApproved !== undefined && hoursApproved > (request.hoursRequested || 8)) {
        return res.status(400).json({ message: "Hours approved cannot exceed hours requested" });
      }
      if (hoursApproved !== undefined && hoursApproved < MIN_TIME_OFF_HOURS_APPROVED) {
        return res.status(400).json({ message: `Hours approved must be at least ${MIN_TIME_OFF_HOURS_APPROVED}` });
      }
      if (approvedEndDate && (approvedEndDate < request.startDate || approvedEndDate > request.endDate)) {
        return res.status(400).json({ message: "Approved end date must be within the requested date range" });
      }

      const isPartial = hoursApproved !== undefined && hoursApproved < (request.hoursRequested || 8);
      const status = isPartial ? "partially_approved" : "approved";

      const finalHoursApproved = isPartial ? hoursApproved : undefined;
      let finalApprovedEndDate: string | undefined;
      if (isPartial) {
        if (approvedEndDate) {
          finalApprovedEndDate = approvedEndDate;
        } else {
          const approvedDays = Math.max(1, Math.ceil((hoursApproved ?? 0) / 8));
          const start = new Date(request.startDate + "T00:00:00");
          start.setDate(start.getDate() + approvedDays - 1);
          finalApprovedEndDate = start.toISOString().split("T")[0];
        }
      }

      const auditCtx = getAuditContext(req);

      const updated = await db.transaction(async (tx) => {
        const [result] = await tx.update(timeOffRequests).set({
          status,
          reviewedBy: user.id,
          reviewedAt: new Date(),
          ...(finalHoursApproved !== undefined ? { hoursApproved: finalHoursApproved } : {}),
          ...(finalApprovedEndDate ? { approvedEndDate: finalApprovedEndDate } : {}),
          ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
        }).where(and(
          eq(timeOffRequests.id, requestId),
          eq(timeOffRequests.status, "pending"),
        )).returning();

        if (!result) {
          throw new RouteConflictError("This request was already handled by someone else.");
        }

        await writeAuditLog({
          actorUserId: user.id,
          targetType: "time_off_request",
          targetId: requestId,
          action: isPartial ? "time_off.partially_approved" : "time_off.approved",
          oldValue: { status: "pending" },
          newValue: { status, ...(isPartial ? { hoursApproved: finalHoursApproved, approvedEndDate: finalApprovedEndDate ?? request.endDate } : {}) },
          context: { comment, employeeId: request.userId, type: request.type, hoursRequested: request.hoursRequested, ...(isPartial ? { hoursApproved: finalHoursApproved, approvedEndDate: finalApprovedEndDate ?? request.endDate } : {}) },
          ...auditCtx,
        }, tx);

        await writeLedgerEntry({
          category: "pto",
          eventType: isPartial ? "pto_partially_approved" : "pto_approved",
          employeeId: request.userId,
          actorUserId: user.id,
          entityType: "time_off_request",
          entityId: requestId,
          workDate: request.startDate,
          beforeValue: { status: "pending" },
          afterValue: { status, hoursApproved: finalHoursApproved ?? request.hoursRequested, approvedEndDate: finalApprovedEndDate ?? request.endDate },
          context: { comment, type: request.type, hoursRequested: request.hoursRequested },
          source: "manager",
          ...getLedgerContext(req),
        }, tx);

        return result;
      });

      // Approved PTO changes the ledger's per-day PTO display for the covered
      // range — refresh those days for the employee.
      const ptoEnd = finalApprovedEndDate ?? request.endDate;
      void recomputeLedger(request.userId, [request.startDate, ptoEnd]);

      res.json(updated);
    } catch (error) {
      console.error("Error approving time-off request:", error);
      handleRouteError(res, error, "Failed to approve time-off request");
    }
  });

  app.post("/api/time-off/:id/deny", requireAuth, requirePermission("pto.approve"), async (req, res) => {
    try {
      const user = (req as any).authUser as User;
      const parsed = approvalSchema.safeParse(req.body);
      const comment = parsed.success ? parsed.data.comment : undefined;
      const requestId = String(req.params.id) as string;
      const request = await storage.getTimeOffRequest(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

      const teamIds = await getTeamUserIds(user);
      if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to deny this request" });

      const auditCtx = getAuditContext(req);

      const updated = await db.transaction(async (tx) => {
        const [result] = await tx.update(timeOffRequests).set({
          status: "denied",
          reviewedBy: user.id,
          reviewedAt: new Date(),
          ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
        }).where(and(
          eq(timeOffRequests.id, requestId),
          eq(timeOffRequests.status, "pending"),
        )).returning();

        if (!result) {
          throw new RouteConflictError("This request was already handled by someone else.");
        }

        await writeAuditLog({
          actorUserId: user.id,
          targetType: "time_off_request",
          targetId: requestId,
          action: "time_off.denied",
          oldValue: { status: "pending" },
          newValue: { status: "denied" },
          context: { comment, employeeId: request.userId, type: request.type, hours: request.hoursRequested },
          ...auditCtx,
        }, tx);

        await writeLedgerEntry({
          category: "pto",
          eventType: "pto_denied",
          employeeId: request.userId,
          actorUserId: user.id,
          entityType: "time_off_request",
          entityId: requestId,
          workDate: request.startDate,
          beforeValue: { status: "pending" },
          afterValue: { status: "denied" },
          context: { comment, type: request.type, hoursRequested: request.hoursRequested },
          source: "manager",
          ...getLedgerContext(req),
        }, tx);

        return result;
      });

      // Defensive: a pending->denied transition doesn't change approved ledger
      // coverage today, but recompute keeps every PTO status change consistent.
      void recomputeLedger(request.userId, [request.startDate, request.endDate]);

      res.json(updated);
    } catch (error) {
      console.error("Error denying time-off request:", error);
      handleRouteError(res, error, "Failed to deny time-off request");
    }
  });

  // One-time / re-runnable cleanup for corrupt time_off_requests hours values.
  // Scans for non-finite, negative, zero, or absurdly large hours_requested /
  // hours_approved values and resets them to a sane fallback (the implied
  // business-day hours for the request's date range, or null for hoursApproved).
  // Every fix writes an audit_logs entry so admins can trace what changed.
  app.post(
    "/api/time-off/cleanup-invalid-hours",
    requireAuth,
    requirePermission("pto.manage_policies"),
    async (req, res) => {
      try {
        const actor = (req as any).authUser as User;
        const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;
        const all = await db.select().from(timeOffRequests);
        const auditCtx = getAuditContext(req);

        const businessDayHours = (startDate: string, endDate: string): number => {
          const startMs = new Date(startDate + "T00:00:00Z").getTime();
          const endMs = new Date(endDate + "T00:00:00Z").getTime();
          if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return 8;
          let days = 0;
          const cur = new Date(startMs);
          while (cur.getTime() <= endMs) {
            const d = cur.getUTCDay();
            if (d !== 0 && d !== 6) days++;
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
          return Math.max(1, days) * 8;
        };

        const fixed: Array<{
          id: string;
          userId: string;
          oldHoursRequested: number | null;
          newHoursRequested: number;
          oldHoursApproved: number | null;
          newHoursApproved: number | null;
        }> = [];

        for (const r of all) {
          const badRequested = !isSaneTimeOffHours(r.hoursRequested);
          const badApproved =
            r.hoursApproved !== null &&
            r.hoursApproved !== undefined &&
            !isSaneTimeOffHours(r.hoursApproved);
          if (!badRequested && !badApproved) continue;

          const safeRequested = badRequested
            ? Math.min(businessDayHours(r.startDate, r.endDate), MAX_TIME_OFF_HOURS_PER_REQUEST)
            : r.hoursRequested;
          const safeApproved = badApproved ? null : r.hoursApproved ?? null;

          fixed.push({
            id: r.id,
            userId: r.userId,
            oldHoursRequested: r.hoursRequested,
            newHoursRequested: safeRequested,
            oldHoursApproved: r.hoursApproved ?? null,
            newHoursApproved: safeApproved,
          });

          if (dryRun) continue;

          await db.transaction(async (tx) => {
            await tx
              .update(timeOffRequests)
              .set({
                hoursRequested: safeRequested,
                hoursApproved: safeApproved,
              })
              .where(eq(timeOffRequests.id, r.id));

            await writeAuditLog(
              {
                actorUserId: actor.id,
                targetType: "time_off_request",
                targetId: r.id,
                action: "time_off.hours_cleanup",
                oldValue: {
                  hoursRequested: r.hoursRequested,
                  hoursApproved: r.hoursApproved ?? null,
                },
                newValue: {
                  hoursRequested: safeRequested,
                  hoursApproved: safeApproved,
                },
                context: {
                  employeeId: r.userId,
                  reason: "Reset out-of-range hours value (task #230 backfill)",
                  badRequested,
                  badApproved,
                },
                ...auditCtx,
              },
              tx,
            );
          });
        }

        res.json({ dryRun, scanned: all.length, fixedCount: fixed.length, fixed });
      } catch (err) {
        console.error("Error running time-off hours cleanup:", err);
        handleRouteError(res, err, "Failed to clean up time-off hours");
      }
    },
  );

  app.get("/api/time-off/processed", requireAuth, requirePermission("pto.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const { department, location, type, status, startDate, endDate } = req.query as Record<string, string | undefined>;

    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const allDepartments = await storage.getAllDepartments();
    const allLocations = await storage.getAllLocations();
    const deptMap = new Map(allDepartments.map(d => [d.id, d]));
    const locMap = new Map(allLocations.map(l => [l.id, l]));
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    let scopedUserIds: string[] | undefined;

    if (user.role === "manager") {
      const teamIds = await getTeamUserIds(user);
      scopedUserIds = Array.from(teamIds);
    } else if (user.role === "admin") {
      let filteredUsers = allUsers;
      if (department) {
        filteredUsers = filteredUsers.filter(u => userDepartmentIds(u).includes(department));
      }
      if (location) {
        filteredUsers = filteredUsers.filter(u => userLocationIds(u).includes(location));
      }
      if (filteredUsers.length !== allUsers.length) {
        scopedUserIds = filteredUsers.map(u => u.id);
      }
    }

    const filters: Parameters<typeof storage.getProcessedTimeOffRequests>[0] = {};
    if (user.role === "manager") {
      filters.userIds = scopedUserIds ?? [];
    } else if (scopedUserIds) {
      filters.userIds = scopedUserIds;
    }
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const requests = await storage.getProcessedTimeOffRequests(filters);

    let deptManagerMap = new Map<string, string[]>();
    if (user.role === "admin") {
      deptManagerMap = await buildDeptManagerNameMap(userMap);
    }

    const enriched = requests.map(r => {
      const emp = userMap.get(r.userId);
      const display = resolveMembershipDisplay(emp, deptMap, locMap, user.role === "admin" ? deptManagerMap : null);
      return {
        ...r,
        employeeName: emp ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim() : "Unknown",
        departmentId: display.departmentId,
        locationId: display.locationId,
        departmentName: display.departmentName || "N/A",
        locationName: display.locationName || "N/A",
        managerNames: display.managerNames,
        reviewerName: (() => {
          if (!r.reviewedBy) return "N/A";
          const u = userMap.get(r.reviewedBy);
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
        })(),
      };
    });
    res.json(enriched);
  });

  app.get("/api/managers", requireAuth, requirePermission("users.view"), async (req, res) => {
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allDepartments = await storage.getAllDepartments();
    const namesSet = new Set<string>();
    await Promise.all(allDepartments.map(async (dept) => {
      const managers = await storage.getDepartmentManagers(dept.id);
      managers.forEach(m => {
        const mu = userMap.get(m.userId);
        const name = mu ? `${mu.firstName || ""} ${mu.lastName || ""}`.trim() : "";
        if (name) namesSet.add(name);
      });
    }));
    const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));
    res.json(names);
  });

  app.get("/api/admin/company-stats", requireAuth, requirePermission("company.view"), requestCache({ scope: "user" }), async (req, res) => {
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const pendingRequests = await storage.getPendingTimeOffRequests();
    const allTimeOff = await storage.getAllTimeOffRequests();

    const activeNow = todayAttendance.filter(a => a.clockIn && !a.clockOut).length;
    const usingPto = allTimeOff.filter(r =>
      (r.status === "approved" || r.status === "partially_approved") && r.startDate <= today && (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
    ).length;

    res.json({
      totalEmployees: allUsers.length,
      activeNow,
      usingPto,
      pendingRequests: pendingRequests.length,
    });
  });

  app.get("/api/admin/department-breakdown", requireAuth, requirePermission("departments.view"), async (req, res) => {
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const depts = await storage.getAllDepartments();
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const allTimeOff = await storage.getAllTimeOffRequests();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Weekly hours come from the canonical attendance ledger (the unified pay
    // engine's break-deducted, rounded per-day split) — NOT raw clockOut-clockIn
    // math. One ledger read covers every employee for the week; per-department
    // totals are summed from each member's ledger.
    const now = new Date();
    const ledgerByUser = await getLedgerForEmployees(allUsers, weekStartStr, today, now);
    const userWeekHours = new Map<string, number>();
    for (const u of allUsers) {
      userWeekHours.set(u.id, summarizeLedger(ledgerByUser.get(u.id) || []).totalHours);
    }

    const breakdown = depts.map(dept => {
      const deptUsers = allUsers.filter(u => userDepartmentIds(u).includes(dept.id));
      const deptIds = new Set(deptUsers.map(u => u.id));
      const active = todayAttendance.filter(a => deptIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;
      const usingPto = allTimeOff.filter(r =>
        deptIds.has(r.userId) && (r.status === "approved" || r.status === "partially_approved") && r.startDate <= today && (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
      ).length;

      let totalHours = 0;
      for (const u of deptUsers) {
        totalHours += userWeekHours.get(u.id) ?? 0;
      }
      const avgHrs = deptUsers.length > 0 ? Math.round((totalHours / deptUsers.length) * 10) / 10 : 0;

      return {
        id: dept.id,
        name: dept.name,
        employees: deptUsers.length,
        active,
        usingPto,
        avgHoursPerWeek: avgHrs,
      };
    });

    const unassigned = allUsers.filter(u => userDepartmentIds(u).length === 0);
    if (unassigned.length > 0) {
      const unassignedIds = new Set(unassigned.map(u => u.id));
      const active = todayAttendance.filter(a => unassignedIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;
      breakdown.push({
        id: "unassigned",
        name: "Unassigned",
        employees: unassigned.length,
        active,
        usingPto: 0,
        avgHoursPerWeek: 0,
      });
    }

    res.json(breakdown);
  });

  app.get("/api/admin/recent-activity", requireAuth, requirePermission("company.view"), async (req, res) => {
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const pendingRequests = await storage.getPendingTimeOffRequests();
    const processed = await storage.getProcessedTimeOffRequests();

    const today = new Date().toISOString().split("T")[0];
    const todayProcessed = processed.filter(r => {
      if (!r.reviewedAt) return false;
      return new Date(r.reviewedAt).toISOString().split("T")[0] === today;
    });

    const activities: { text: string; timestamp: string }[] = [];

    if (pendingRequests.length > 0) {
      activities.push({ text: `${pendingRequests.length} pending time-off request(s)`, timestamp: new Date().toISOString() });
    }
    if (todayProcessed.length > 0) {
      const approved = todayProcessed.filter(r => r.status === "approved" || r.status === "partially_approved").length;
      const denied = todayProcessed.filter(r => r.status === "denied").length;
      if (approved > 0) activities.push({ text: `${approved} request(s) approved today`, timestamp: new Date().toISOString() });
      if (denied > 0) activities.push({ text: `${denied} request(s) denied today`, timestamp: new Date().toISOString() });
    }

    const recentUsers = allUsers
      .filter(u => u.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, 3);
    if (recentUsers.length > 0) {
      activities.push({ text: `${recentUsers.length} newest employee(s) added`, timestamp: recentUsers[0].createdAt?.toISOString() || new Date().toISOString() });
    }

    res.json(activities);
  });

  app.get(
    "/api/reports/filter-options",
    requireAuth,
    requirePermission("reports.view"),
    async (req, res) => {
      const user = (req as any).authUser as User;
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const teamIds = await getTeamUserIds(user);
      const scopedUsers = allUsers.filter(u => teamIds.has(u.id));

      const employees = scopedUsers
        .map(u => ({
          id: u.id,
          name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Unknown",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const allDepartments = await storage.getAllDepartments();
      const allLocations = await storage.getAllLocations();
      const allCompanies = await storage.getAllCompanies();

      let departments = allDepartments;
      let locations = allLocations;
      let companies = allCompanies;

      if (user.role !== "admin") {
        const deptIds = new Set(scopedUsers.flatMap(u => userDepartmentIds(u)));
        const locIds = new Set(scopedUsers.flatMap(u => userLocationIds(u)));
        const compIds = new Set(scopedUsers.map(u => u.companyId).filter(Boolean) as string[]);
        departments = allDepartments.filter(d => deptIds.has(d.id));
        locations = allLocations.filter(l => locIds.has(l.id));
        companies = allCompanies.filter(c => compIds.has(c.id));
      }

      res.json({
        employees,
        departments: departments.map(d => ({ id: d.id, name: d.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        locations: locations.map(l => ({ id: l.id, name: l.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        companies: companies.map(c => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    },
  );

  const idArrayField = z.preprocess(
    (v) => (typeof v === "string" ? [v] : v),
    z.array(z.string().min(1)).optional(),
  );

  const reportSchema = z.object({
    // The report CATEGORY (what data to show) is distinct from the access
    // SCOPE (reportType: employee/team/company, which only narrows whose data
    // a user may see). Older clients that omit `category` get the attendance
    // summary, preserving the previous default shape.
    category: z
      .enum(["attendance", "time", "pto", "missing-punches", "exceptions"])
      .optional()
      .default("attendance"),
    reportType: z.enum(["employee", "team", "company"]).optional().default("company"),
    startDate: z.string(),
    endDate: z.string(),
    department: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.string().optional(),
    departmentIds: idArrayField,
    employeeIds: idArrayField,
    locationIds: idArrayField,
    companyIds: idArrayField,
    taxClassifications: z.preprocess(
      (v) => (typeof v === "string" ? [v] : v),
      z.array(z.enum(["W-2", "1099"])).optional(),
    ),
  });

  app.post("/api/reports/generate", requireAuth, requirePermission("reports.view"), async (req, res) => {
    const cdUser = (req as any).authUser as User;
    const cdKey = `reports:generate:${cdUser?.id ?? "anon"}:${JSON.stringify(req.body ?? {})}`;
    const gate = shouldRun(cdKey);
    if (!gate.ok) {
      return res.status(202).json({
        message: `Report generation cooling down. Try again in ${Math.ceil(gate.retryAfterMs / 1000)}s.`,
        retryAfterMs: gate.retryAfterMs,
      });
    }
    const user = (req as any).authUser as User;
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid report parameters", errors: parsed.error.flatten() });
    }

    const { category, reportType, startDate, endDate, department, employeeId, status, departmentIds, employeeIds, locationIds, companyIds, taxClassifications } = parsed.data;
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const depts = await storage.getAllDepartments();
    const deptMap = new Map(depts.map(d => [d.id, d.name]));

    const teamIds = await getTeamUserIds(user);
    let filteredUsers = allUsers.filter(u => teamIds.has(u.id));

    if (reportType === "employee" && employeeId) {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    } else if (reportType === "team") {
      const ownDeptIds = userDepartmentIds(user);
      if (ownDeptIds.length > 0) {
        filteredUsers = filteredUsers.filter(u => userDepartmentIds(u).some(d => ownDeptIds.includes(d)));
      }
    }

    if (department && department !== "all") {
      filteredUsers = filteredUsers.filter(u => userDepartmentIds(u).includes(department));
    }
    if (employeeId && reportType !== "employee") {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    }

    if (departmentIds && departmentIds.length > 0) {
      const set = new Set(departmentIds);
      filteredUsers = filteredUsers.filter(u => userDepartmentIds(u).some(d => set.has(d)));
    }
    if (employeeIds && employeeIds.length > 0) {
      const set = new Set(employeeIds);
      filteredUsers = filteredUsers.filter(u => set.has(u.id));
    }
    if (locationIds && locationIds.length > 0) {
      const set = new Set(locationIds);
      filteredUsers = filteredUsers.filter(u => userLocationIds(u).some(l => set.has(l)));
    }
    if (companyIds && companyIds.length > 0) {
      const set = new Set(companyIds);
      filteredUsers = filteredUsers.filter(u => u.companyId && set.has(u.companyId));
    }

    // Tax classification filter requires employment profiles. Fetch them in ONE
    // batched query (was an N+1 loop). The column is also included in the
    // response payload (and CSV exports) so HR can pull e.g. "Ahava → 1099".
    const profileMap = await storage.getEmploymentProfilesByUserIds(filteredUsers.map(u => u.id));
    const taxByUser = new Map<string, string>();
    for (const u of filteredUsers) {
      taxByUser.set(u.id, profileMap.get(u.id)?.taxClassification || "W-2");
    }

    // Per-employee payroll company (a payroll-only assignment independent of the
    // org dept/location). Resolve the id → name once via a companies lookup so
    // the report and its CSV can show the employer name; blank when unset.
    const allCompaniesForReport = await storage.getAllCompanies();
    const companyNameById = new Map(allCompaniesForReport.map(c => [c.id, c.name]));
    const payrollCompanyByUser = new Map<string, string>();
    for (const u of filteredUsers) {
      const pcId = profileMap.get(u.id)?.payrollCompanyId;
      payrollCompanyByUser.set(u.id, pcId ? (companyNameById.get(pcId) || "") : "");
    }
    if (taxClassifications && taxClassifications.length > 0) {
      const set = new Set(taxClassifications);
      filteredUsers = filteredUsers.filter(u => set.has(taxByUser.get(u.id) as any || "W-2"));
    }

    // Final scoped users (after permission + all filters). Every category below
    // reuses this same set + date range, so scope/visibility and the shared
    // filters apply uniformly regardless of which report is requested.
    const now = new Date();
    const finalUserIds = filteredUsers.map(u => u.id);
    const userById = new Map(filteredUsers.map(u => [u.id, u]));
    const nameOf = (u: User | undefined) =>
      u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown") : "Unknown";
    const deptOf = (u: User | undefined) =>
      u && u.departmentId ? (deptMap.get(u.departmentId) || "Unassigned") : "Unassigned";

    // Each report category returns a self-describing payload of
    // { category, columns, rows } so the client (table + CSV) adapts to the
    // shape without hard-coding columns per tab. `columns[].kind` tells the
    // client how to format a cell (hours / date / datetime / number / text).
    type ReportColumn = { key: string; label: string; kind?: "hours" | "date" | "datetime" | "number" | "text" };

    if (category === "pto") {
      const requests = await storage.getTimeOffRequestsByDateRange(startDate, endDate, finalUserIds, status);
      const columns: ReportColumn[] = [
        { key: "employeeName", label: "Employee", kind: "text" },
        { key: "department", label: "Department", kind: "text" },
        { key: "type", label: "Type", kind: "text" },
        { key: "startDate", label: "Start Date", kind: "date" },
        { key: "endDate", label: "End Date", kind: "date" },
        { key: "days", label: "Days", kind: "number" },
        { key: "hours", label: "Hours", kind: "number" },
        { key: "status", label: "Status", kind: "text" },
      ];
      const rows = requests.map(r => {
        const u = userById.get(r.userId);
        const effectiveEnd = r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate;
        const days = Math.max(
          0,
          Math.round((new Date(effectiveEnd).getTime() - new Date(r.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
        );
        return {
          id: r.id,
          employeeName: nameOf(u),
          department: deptOf(u),
          type: r.type,
          startDate: r.startDate,
          endDate: effectiveEnd,
          days,
          hours: Math.round(((r.hoursApproved ?? r.hoursRequested) || 0) * 10) / 10,
          status: r.status,
        };
      });
      return res.json({ category, columns, rows });
    }

    if (category === "missing-punches") {
      const punches = await storage.getIncompletePunchesByDateRange(startDate, endDate, finalUserIds);
      const columns: ReportColumn[] = [
        { key: "employeeName", label: "Employee", kind: "text" },
        { key: "department", label: "Department", kind: "text" },
        { key: "workDate", label: "Date", kind: "date" },
        { key: "clockIn", label: "Clock In", kind: "datetime" },
        { key: "clockOut", label: "Clock Out", kind: "datetime" },
        { key: "issue", label: "Issue", kind: "text" },
      ];
      const rows = punches.map(p => {
        const u = userById.get(p.employeeId);
        return {
          id: p.id,
          employeeName: nameOf(u),
          department: deptOf(u),
          workDate: p.workDate,
          clockIn: p.clockIn ? new Date(p.clockIn).toISOString() : null,
          clockOut: p.clockOut ? new Date(p.clockOut).toISOString() : null,
          issue: p.status === "in-progress" ? "Still clocked in" : "Missing clock-out",
        };
      });
      return res.json({ category, columns, rows });
    }

    if (category === "exceptions") {
      const exceptions = await storage.getAttendanceExceptionsByDateRange(startDate, endDate, finalUserIds, status);
      const columns: ReportColumn[] = [
        { key: "employeeName", label: "Employee", kind: "text" },
        { key: "department", label: "Department", kind: "text" },
        { key: "exceptionDate", label: "Date", kind: "date" },
        { key: "type", label: "Type", kind: "text" },
        { key: "status", label: "Status", kind: "text" },
        { key: "reason", label: "Reason", kind: "text" },
        { key: "reviewedAt", label: "Reviewed", kind: "datetime" },
      ];
      const rows = exceptions.map(e => {
        const u = userById.get(e.employeeId);
        return {
          id: e.id,
          employeeName: nameOf(u),
          department: deptOf(u),
          exceptionDate: e.exceptionDate,
          type: e.type,
          status: e.status,
          reason: e.reason,
          reviewedAt: e.reviewedAt ? new Date(e.reviewedAt).toISOString() : null,
        };
      });
      return res.json({ category, columns, rows });
    }

    // Hours-based categories (attendance, time) read EVERY worked-hours figure —
    // total hours, days worked AND overtime — from the canonical attendance
    // ledger (the single materialization of the unified pay engine's per-day
    // split). This guarantees the report's numbers are byte-for-byte identical to
    // the per-employee timesheet, the dashboards and the payroll batch, because
    // they all read the same ledger. `now` is captured once so in-progress
    // punches are consistent across employees. Days off (PTO) stay sourced from
    // the authoritative time_off_requests.
    //
    // Scoping note (live vs. frozen): this is a LIVE operational read path, so the
    // ledger recomputes against the CURRENT effective policy — a manager pulling a
    // report today sees today's thresholds/multipliers. Historical dollar
    // stability is the job of the payroll batch SNAPSHOT, not live reads.
    const [daysOffByUser, ledgerByUser] = await Promise.all([
      storage.getTimeOffDaysOffByDateRange(startDate, endDate, finalUserIds, status),
      getLedgerForEmployees(filteredUsers, startDate, endDate, now),
    ]);
    // Overtime (including any weekly reclassification) is read straight from the
    // canonical ledger, which is itself weekly-aware (its per-day split runs
    // through the engine's computeWeeklyHours over the read range). So the report,
    // the per-employee timesheet and the dashboards all surface the SAME OT — no
    // surface re-derives it. The single OT column reports OT + double-time
    // combined.
    const ledgerTotalsByUser = new Map<string, ReturnType<typeof summarizeLedger>>();
    for (const u of filteredUsers) {
      ledgerTotalsByUser.set(u.id, summarizeLedger(ledgerByUser.get(u.id) || []));
    }

    if (category === "time") {
      const columns: ReportColumn[] = [
        { key: "employeeName", label: "Employee", kind: "text" },
        { key: "taxClassification", label: "Tax Class", kind: "text" },
        { key: "payrollCompany", label: "Payroll Company", kind: "text" },
        { key: "department", label: "Department", kind: "text" },
        { key: "daysWorked", label: "Days Worked", kind: "number" },
        { key: "totalHours", label: "Total Hours", kind: "hours" },
        { key: "avgHoursPerDay", label: "Avg Hours/Day", kind: "hours" },
        { key: "overtime", label: "Overtime", kind: "hours" },
      ];
      const rows = filteredUsers.map(u => {
        const totals = ledgerTotalsByUser.get(u.id);
        const totalHours = totals?.totalHours ?? 0;
        const daysWorked = totals?.daysWorked ?? 0;
        const overtime = totals?.overtimeCombined ?? 0;
        const avg = daysWorked > 0 ? totalHours / daysWorked : 0;
        return {
          id: u.id,
          employeeName: nameOf(u),
          taxClassification: taxByUser.get(u.id) || "W-2",
          payrollCompany: payrollCompanyByUser.get(u.id) || "",
          department: deptOf(u),
          daysWorked,
          totalHours: Math.round(totalHours * 10) / 10,
          avgHoursPerDay: Math.round(avg * 10) / 10,
          overtime: Math.round(overtime * 10) / 10,
        };
      });
      return res.json({ category, columns, rows });
    }

    // Default: attendance summary (also the legacy default shape).
    const attendanceColumns: ReportColumn[] = [
      { key: "employeeName", label: "Employee", kind: "text" },
      { key: "taxClassification", label: "Tax Class", kind: "text" },
      { key: "payrollCompany", label: "Payroll Company", kind: "text" },
      { key: "department", label: "Department", kind: "text" },
      { key: "totalHours", label: "Total Hours", kind: "hours" },
      { key: "daysWorked", label: "Days Worked", kind: "number" },
      { key: "daysOff", label: "Days Off", kind: "number" },
      { key: "overtime", label: "Overtime", kind: "hours" },
    ];
    const attendanceRows = filteredUsers.map(u => {
      const totals = ledgerTotalsByUser.get(u.id);
      const totalHours = totals?.totalHours ?? 0;
      const daysWorked = totals?.daysWorked ?? 0;
      const daysOff = daysOffByUser.get(u.id) ?? 0;
      const overtime = totals?.overtimeCombined ?? 0;
      return {
        id: u.id,
        employeeName: nameOf(u),
        taxClassification: taxByUser.get(u.id) || "W-2",
        payrollCompany: payrollCompanyByUser.get(u.id) || "",
        department: deptOf(u),
        totalHours: Math.round(totalHours * 10) / 10,
        daysWorked,
        daysOff,
        overtime: Math.round(overtime * 10) / 10,
      };
    });

    res.json({ category: "attendance", columns: attendanceColumns, rows: attendanceRows });
  });

  app.get("/api/pto-policies", requireAuth, requirePermission("pto.manage_policies"), async (_req, res) => {
    try {
      const policies = await storage.getAllPtoPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching PTO policies:", error);
      handleRouteError(res, error, "Failed to fetch PTO policies");
    }
  });

  app.get("/api/pto-policies/:id", requireAuth, requirePermission("pto.manage_policies"), async (req, res) => {
    try {
      const policy = await storage.getPtoPolicy(String(req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });
      res.json(policy);
    } catch (error) {
      console.error("Error fetching PTO policy:", error);
      handleRouteError(res, error, "Failed to fetch PTO policy");
    }
  });

  // PTO policy CREATE/UPDATE/DELETE were retired in the PTO consolidation
  // (task #397). PTO policies are now authored through the unified policy engine
  // (`/api/policies`, type "pto") and the legacy `pto_policies` table is dormant.
  // The GET routes above remain for backward-compatible reads only.

  app.get("/api/employee-pto-settings/:userId", requireAuth, requirePermission("pto.view_team"), async (req, res) => {
    try {
      const settings = await storage.getEmployeePtoSettings(String(req.params.userId));
      if (!settings) return res.json(null);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching employee PTO settings:", error);
      handleRouteError(res, error, "Failed to fetch employee PTO settings");
    }
  });

  app.post("/api/employee-pto-settings", requireAuth, requirePermission("pto.manage_policies"), async (req: any, res) => {
    try {
      const parsed = insertEmployeePtoSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings data", errors: parsed.error.flatten() });
      }

      const existing = await storage.getEmployeePtoSettings(parsed.data.userId);
      let settings;
      if (existing) {
        settings = await storage.updateEmployeePtoSettings(parsed.data.userId, parsed.data);
      } else {
        settings = await storage.createEmployeePtoSettings(parsed.data);
      }

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: existing ? "employee_pto.updated" : "employee_pto.created",
        targetId: parsed.data.userId,
        targetType: "employee_pto_settings",
        newValue: { changes: Object.keys(parsed.data).filter(k => k !== "userId") },
        ...getAuditContext(req),
      });

      await writeLedgerEntry({
        category: "pto",
        eventType: existing ? "pto_settings_updated" : "pto_settings_created",
        employeeId: parsed.data.userId,
        actorUserId: req.authUser.id,
        entityType: "employee_pto_settings",
        entityId: parsed.data.userId,
        beforeValue: existing ?? null,
        afterValue: settings ?? null,
        source: "manager",
        ...getLedgerContext(req),
      });

      res.json(settings);
    } catch (error) {
      console.error("Error saving employee PTO settings:", error);
      handleRouteError(res, error, "Failed to save employee PTO settings");
    }
  });

  app.patch("/api/employee-pto-settings/:userId", requireAuth, requirePermission("pto.manage_policies"), async (req: any, res) => {
    try {
      const ptoUserId = String(req.params.userId);
      const before = await storage.getEmployeePtoSettings(ptoUserId);
      const settings = await storage.updateEmployeePtoSettings(ptoUserId, req.body);
      if (!settings) return res.status(404).json({ message: "Employee PTO settings not found" });

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "employee_pto.balance_adjusted",
        targetId: ptoUserId,
        targetType: "employee_pto_settings",
        newValue: { changes: req.body },
        ...getAuditContext(req),
      });

      await writeLedgerEntry({
        category: "pto",
        eventType: "pto_balance_adjusted",
        employeeId: ptoUserId,
        actorUserId: req.authUser.id,
        entityType: "employee_pto_settings",
        entityId: ptoUserId,
        beforeValue: before ?? null,
        afterValue: settings,
        context: { changes: req.body },
        source: "manager",
        ...getLedgerContext(req),
      });

      res.json(settings);
    } catch (error) {
      console.error("Error updating employee PTO settings:", error);
      handleRouteError(res, error, "Failed to update employee PTO settings");
    }
  });

  app.get("/api/employee-pto-policy/:userId", requireAuth, requirePermission("pto.view_team"), async (req, res) => {
    try {
      const policy = await storage.getEmployeePtoPolicy(String(req.params.userId));
      res.json(policy || null);
    } catch (error) {
      console.error("Error fetching employee PTO policy:", error);
      handleRouteError(res, error, "Failed to fetch employee PTO policy");
    }
  });

  // Employee-level PTO policy ASSIGNMENT, routed through the unified policy
  // engine's policy_assignments (NOT the legacy employee_pto_settings.pto_policy_id
  // link). Returns the explicit employee-level assignment (if any), the resolved
  // effective policy (when the employee inherits), and the selectable PTO policies.
  app.get("/api/employee-pto-assignment/:userId", requireAuth, requirePermission("pto.view_team"), async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const [assignment, available, effective] = await Promise.all([
        storage.getEmployeePtoAssignment(userId),
        storage.getSelectablePtoPolicies(),
        storage.getEmployeePtoPolicy(userId),
      ]);
      res.json({
        assignmentId: assignment?.id ?? null,
        policyId: assignment?.policyId ?? null,
        effectivePolicyId: (effective as any)?.id ?? null,
        effectivePolicyName: (effective as any)?.name ?? null,
        policies: available.map((p) => ({
          id: p.id,
          name: p.name,
          isSystemDefault: p.isSystemDefault,
        })),
      });
    } catch (error) {
      console.error("Error fetching employee PTO assignment:", error);
      handleRouteError(res, error, "Failed to fetch employee PTO assignment");
    }
  });

  // Upsert the employee-level PTO policy assignment. `policyId: null` clears the
  // employee-level override so the employee inherits a higher-scope policy again.
  app.put("/api/employee-pto-assignment/:userId", requireAuth, requirePermission("pto.manage_policies"), async (req: any, res) => {
    try {
      const userId = String(req.params.userId);
      const rawPolicyId = req.body?.policyId;
      const policyId =
        rawPolicyId === null || rawPolicyId === undefined || rawPolicyId === ""
          ? null
          : String(rawPolicyId);

      const target = await storage.getUser(userId);
      if (!target) return res.status(404).json({ message: "Employee not found." });

      const existing = await storage.getEmployeePtoAssignment(userId);

      if (policyId === null) {
        if (existing) {
          await storage.deletePolicyAssignment(existing.id);
          await writeAuditLog({
            actorUserId: req.authUser.id,
            action: "policy_assignment.deleted",
            targetId: existing.id,
            targetType: "policy_assignment",
            oldValue: { policyId: existing.policyId, userId },
            ...getAuditContext(req),
          });
        }
        return res.json({ assignmentId: null, policyId: null });
      }

      const selectable = await storage.getSelectablePtoPolicies();
      if (!selectable.some((p) => p.id === policyId)) {
        return res.status(400).json({ message: "Selected policy is not an active PTO policy." });
      }

      let result;
      if (existing) {
        result = await storage.updatePolicyAssignment(existing.id, { policyId });
        await writeAuditLog({
          actorUserId: req.authUser.id,
          action: "policy_assignment.updated",
          targetId: existing.id,
          targetType: "policy_assignment",
          oldValue: { policyId: existing.policyId, userId },
          newValue: { policyId, userId },
          ...getAuditContext(req),
        });
      } else {
        result = await storage.createPolicyAssignment({ policyId, userId } as any);
        await writeAuditLog({
          actorUserId: req.authUser.id,
          action: "policy_assignment.created",
          targetId: result.id,
          targetType: "policy_assignment",
          newValue: { policyId, userId },
          ...getAuditContext(req),
        });
      }

      res.json({ assignmentId: result?.id ?? null, policyId });
    } catch (error) {
      console.error("Error updating employee PTO assignment:", error);
      handleRouteError(res, error, "Failed to update employee PTO assignment");
    }
  });

  app.get("/api/audit-logs", requireAuth, requirePermission("audit.view"), async (req, res) => {
    try {
      const module = req.query.module as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getAuditLogs(module, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      handleRouteError(res, error, "Failed to fetch audit logs");
    }
  });

  // Server-side, user-scoped audit log feed for the Employee Profile
  // History/Audit tab. Replaces a client-side filter over a global limit=1000
  // fetch so older entries are no longer dropped.
  app.get("/api/audit-logs/employee/:userId", requireAuth, async (req: any, res) => {
    try {
      const requester = req.authUser as User;
      const { userId } = req.params;

      if (userId !== requester.id) {
        if (requester.role !== "admin" && requester.role !== "manager") {
          return res.status(403).json({ message: "Not authorized to view this employee's audit history." });
        }
        const teamIds = await getTeamUserIds(requester);
        if (!teamIds.has(userId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's audit history." });
        }
      }

      const target = await storage.getUser(userId);
      if (!target) return res.status(404).json({ message: "Employee not found." });
      if (target.id === SUPER_ADMIN_USER_ID && requester.id !== SUPER_ADMIN_USER_ID) {
        return res.status(404).json({ message: "Employee not found." });
      }

      const limit = Math.min(parseInt((req.query.limit as string) || "25", 10) || 25, 200);
      const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const result = await storage.getAuditLogsByUser(userId, { limit, offset, startDate, endDate });
      res.json(result);
    } catch (error) {
      console.error("Error fetching employee audit logs:", error);
      handleRouteError(res, error, "Failed to fetch employee audit logs");
    }
  });

  app.get("/api/ledger/employee/:userId", requireAuth, requirePermission("audit.view"), async (req: any, res) => {
    try {
      const requester = req.authUser as User;
      const { userId } = req.params;

      if (userId !== requester.id) {
        if (requester.role !== "admin" && requester.role !== "manager") {
          return res.status(403).json({ message: "Not authorized to view this employee's ledger." });
        }
        const teamIds = await getTeamUserIds(requester);
        if (!teamIds.has(userId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's ledger." });
        }
      }

      const target = await storage.getUser(userId);
      if (!target) return res.status(404).json({ message: "Employee not found." });
      if (target.id === SUPER_ADMIN_USER_ID && requester.id !== SUPER_ADMIN_USER_ID) {
        return res.status(404).json({ message: "Employee not found." });
      }

      const limit = Math.min(parseInt((req.query.limit as string) || "25", 10) || 25, 200);
      const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const categoryRaw = req.query.category as string | undefined;
      const category = categoryRaw && categoryRaw !== "all" ? categoryRaw : undefined;

      const result = await storage.getLedgerEntriesByEmployee(userId, { category, startDate, endDate, limit, offset });
      res.json(result);
    } catch (error) {
      console.error("Error fetching employee ledger:", error);
      handleRouteError(res, error, "Failed to fetch employee ledger");
    }
  });

  app.get("/api/policy-types", requireAuth, async (_req, res) => {
    try {
      const types = await storage.getAllPolicyTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching policy types:", error);
      handleRouteError(res, error, "Failed to fetch policy types");
    }
  });

  app.get("/api/policies", requireAuth, requirePermission("policies.view"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const policies = companyId
        ? await storage.getPoliciesByCompany(companyId)
        : await storage.getAllPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching policies:", error);
      handleRouteError(res, error, "Failed to fetch policies");
    }
  });

  app.get("/api/policies/:id", requireAuth, requirePermission("policies.view"), async (req, res) => {
    try {
      const policy = await storage.getPolicy(String(req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const rules = await storage.getPolicyRulesByPolicy(policy.id);
      const assignments = await storage.getPolicyAssignmentsByPolicy(policy.id);
      res.json({ ...policy, rules: rules[0]?.rules || {}, assignments });
    } catch (error) {
      console.error("Error fetching policy:", error);
      handleRouteError(res, error, "Failed to fetch policy");
    }
  });

  app.post("/api/policies", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const parsed = insertPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        const firstField = Object.keys(flat.fieldErrors)[0];
        const firstMsg = firstField ? `${firstField}: ${(flat.fieldErrors as Record<string, string[] | undefined>)[firstField]?.[0]}` : "Invalid policy data";
        return res.status(400).json({ message: firstMsg, errors: flat });
      }
      if (req.body.rules) {
        const overlapError = validateBonusRuleOverlaps(req.body.rules);
        if (overlapError) {
          return res.status(400).json({ message: overlapError });
        }
      }
      const policy = await storage.createPolicy(parsed.data);

      if (req.body.rules) {
        await storage.upsertPolicyRules(policy.id, req.body.rules);
      }

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy.created",
        targetId: policy.id,
        targetType: "policy",
        newValue: { name: policy.name, status: policy.status },
        ...getAuditContext(req),
      });

      res.status(201).json(policy);
    } catch (error: any) {
      console.error("Error creating policy:", error);
      const pgCode = error?.code;
      if (pgCode === "23503") {
        return res.status(400).json({ message: `Invalid reference: ${error?.detail || error?.message || "foreign key violation"}` });
      }
      if (pgCode === "23505") {
        return res.status(409).json({ message: `Duplicate policy: ${error?.detail || error?.message}` });
      }
      if (pgCode === "23502") {
        return res.status(400).json({ message: `Missing required field: ${error?.column || error?.message}` });
      }
      return handleRouteError(res, error, "Failed to create policy");
    }
  });

  app.patch("/api/policies/:id", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const { rules, ...policyData } = req.body;
      if (rules) {
        const overlapError = validateBonusRuleOverlaps(rules);
        if (overlapError) {
          return res.status(400).json({ message: overlapError });
        }
      }
      const policy = await storage.updatePolicy(String(req.params.id), policyData);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      if (rules) {
        await storage.upsertPolicyRules(policy.id, rules);
      }

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy.updated",
        targetId: policy.id,
        targetType: "policy",
        newValue: { name: policy.name, changes: Object.keys(req.body) },
        ...getAuditContext(req),
      });

      res.json(policy);
    } catch (error: any) {
      console.error("Error updating policy:", error);
      const pgCode = error?.code;
      if (pgCode === "23503") {
        return res.status(400).json({ message: `Invalid reference: ${error?.detail || error?.message || "foreign key violation"}` });
      }
      if (pgCode === "23505") {
        return res.status(409).json({ message: `Duplicate policy: ${error?.detail || error?.message}` });
      }
      if (pgCode === "23502") {
        return res.status(400).json({ message: `Missing required field: ${error?.column || error?.message}` });
      }
      return handleRouteError(res, error, "Failed to update policy");
    }
  });

  app.post("/api/policies/:id/activate", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(String(req.params.id), { status: "active" });
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy.activated",
        targetId: policy.id,
        targetType: "policy",
        newValue: { name: policy.name },
        ...getAuditContext(req),
      });

      res.json(policy);
    } catch (error) {
      console.error("Error activating policy:", error);
      handleRouteError(res, error, "Failed to activate policy");
    }
  });

  app.post("/api/policies/:id/archive", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(String(req.params.id), { status: "archived" });
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy.archived",
        targetId: policy.id,
        targetType: "policy",
        newValue: { name: policy.name },
        ...getAuditContext(req),
      });

      res.json(policy);
    } catch (error) {
      console.error("Error archiving policy:", error);
      handleRouteError(res, error, "Failed to archive policy");
    }
  });

  app.delete("/api/policies/:id", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const policy = await storage.getPolicy(String(req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await storage.deletePolicy(policy.id);

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy.deleted",
        targetId: policy.id,
        targetType: "policy",
        oldValue: { name: policy.name, policyTypeId: policy.policyTypeId, status: policy.status },
        ...getAuditContext(req),
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting policy:", error);
      handleRouteError(res, error, "Failed to delete policy");
    }
  });

  app.get("/api/policies/:id/rules", requireAuth, requirePermission("policies.view"), async (req, res) => {
    try {
      const rules = await storage.getPolicyRulesByPolicy(String(req.params.id));
      res.json(rules[0]?.rules || {});
    } catch (error) {
      console.error("Error fetching policy rules:", error);
      handleRouteError(res, error, "Failed to fetch policy rules");
    }
  });

  app.put("/api/policies/:id/rules", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const policy = await storage.getPolicy(String(req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const body = req.body && typeof req.body === "object" && "rules" in req.body && req.body.rules
        ? req.body.rules
        : req.body;
      const overlapError = validateBonusRuleOverlaps(body);
      if (overlapError) {
        return res.status(400).json({ message: overlapError });
      }
      const rule = await storage.upsertPolicyRules(String(req.params.id), body);

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy_rules.updated",
        targetId: policy.id,
        targetType: "policy_rules",
        newValue: { policyName: policy.name, ruleKeys: Object.keys(req.body) },
        ...getAuditContext(req),
      });

      res.json(rule);
    } catch (error) {
      console.error("Error updating policy rules:", error);
      handleRouteError(res, error, "Failed to update policy rules");
    }
  });

  app.get("/api/roles-summary", requireAuth, requirePermission("policies.view"), async (_req, res) => {
    try {
      const allRoles = await storage.getAllRoles();
      res.json(
        allRoles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          isActive: r.isActive,
          companyId: r.companyId,
        }))
      );
    } catch (error) {
      console.error("Error fetching roles summary:", error);
      handleRouteError(res, error, "Failed to fetch roles");
    }
  });

  // Consolidated assignment-target picker for the policy wizard. Gated by the
  // SAME requireRole("admin") used for policy management itself, so any role that
  // can manage policies can always load every assignment target (companies,
  // locations, departments, users, roles) in one call. This deliberately avoids
  // the per-resource view permissions (company.view / locations.view /
  // departments.view / users.view) the shared list endpoints require — a policy
  // manager whose RBAC role lacks one of those would otherwise get a 403 on that
  // endpoint, leaving the corresponding wizard "Level" silently disabled.
  app.get("/api/policy-assignment-targets", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const [companies, locations, departments, allUsers, allRoles] = await Promise.all([
        storage.getAllCompanies(),
        storage.getAllLocations(),
        storage.getAllDepartments(),
        storage.getAllUsers(),
        storage.getAllRoles(),
      ]);
      res.json({
        companies: companies.map((c) => ({ id: c.id, name: c.name })),
        locations: locations.map((l) => ({ id: l.id, name: l.name })),
        departments: departments.map((d) => ({ id: d.id, name: d.name })),
        users: allUsers.map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
        })),
        roles: allRoles.map((r) => ({ id: r.id, name: r.name })),
      });
    } catch (error) {
      console.error("Error fetching policy assignment targets:", error);
      handleRouteError(res, error, "Failed to fetch policy assignment targets");
    }
  });

  app.get("/api/policy-assignments", requireAuth, requirePermission("policies.view"), async (req, res) => {
    try {
      const policyId = req.query.policyId as string | undefined;
      const assignments = policyId
        ? await storage.getPolicyAssignmentsByPolicy(policyId)
        : await storage.getAllPolicyAssignments();
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching policy assignments:", error);
      handleRouteError(res, error, "Failed to fetch policy assignments");
    }
  });

  app.post("/api/policy-assignments", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const isArray = Array.isArray(req.body);
      const items = isArray ? req.body : [req.body];

      if (items.length === 0) {
        return res.status(400).json({ message: "No assignments provided" });
      }

      const parsedItems: any[] = [];
      const errorsByIndex: Record<number, any> = {};
      const friendlyRowMessages: string[] = [];
      items.forEach((item: unknown, idx: number) => {
        const parsed = insertPolicyAssignmentSchema.safeParse(item);
        if (parsed.success) {
          parsedItems.push(parsed.data);
        } else {
          const flat = parsed.error.flatten();
          errorsByIndex[idx] = flat;
          const issues = parsed.error.issues || [];
          const noTargetIssue = issues.find(
            (i) => typeof i.message === "string" && i.message.includes("Exactly one assignment target")
          );
          const tooManyIssue = issues.find(
            (i) => typeof i.message === "string" && i.message.includes("Only one assignment target")
          );
          let rowMsg: string;
          if (noTargetIssue) {
            rowMsg = `Row ${idx + 1}: please choose a specific division, location, department, employee, role, employment type, or pay type.`;
          } else if (tooManyIssue) {
            rowMsg = `Row ${idx + 1}: ${tooManyIssue.message}`;
          } else {
            const first = issues[0];
            rowMsg = `Row ${idx + 1}: ${first?.message || "invalid data"}`;
          }
          friendlyRowMessages.push(rowMsg);
        }
      });
      if (Object.keys(errorsByIndex).length > 0) {
        return res.status(400).json({
          message: friendlyRowMessages.join(" "),
          errors: errorsByIndex,
        });
      }

      const created = [];
      for (const data of parsedItems) {
        const assignment = await storage.createPolicyAssignment(data);
        created.push(assignment);

        await writeAuditLog({
          actorUserId: req.authUser.id,
          action: "policy_assignment.created",
          targetId: assignment.id,
          targetType: "policy_assignment",
          newValue: {
            policyId: data.policyId,
            companyId: data.companyId,
            locationId: data.locationId,
            departmentId: data.departmentId,
            userId: data.userId,
            roleId: data.roleId,
            employmentType: data.employmentType,
            payType: data.payType,
          },
          ...getAuditContext(req),
        });
      }

      if (isArray) {
        return res.status(201).json(created);
      }
      res.status(201).json(created[0]);
    } catch (error) {
      console.error("Error creating policy assignment:", error);
      handleRouteError(res, error, "Failed to create policy assignment");
    }
  });

  app.patch("/api/policy-assignments/:id", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      const assignment = await storage.updatePolicyAssignment(String(req.params.id), req.body);
      if (!assignment) return res.status(404).json({ message: "Policy assignment not found" });
      res.json(assignment);
    } catch (error) {
      console.error("Error updating policy assignment:", error);
      handleRouteError(res, error, "Failed to update policy assignment");
    }
  });

  app.delete("/api/policy-assignments/:id", requireAuth, requirePermission("policies.manage"), async (req: any, res) => {
    try {
      await storage.deletePolicyAssignment(String(req.params.id));

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy_assignment.deleted",
        targetId: String(req.params.id),
        targetType: "policy_assignment",
        ...getAuditContext(req),
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting policy assignment:", error);
      handleRouteError(res, error, "Failed to delete policy assignment");
    }
  });

  app.get("/api/effective-policy", requireAuth, async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const targetUserId = (req.query.userId as string) || user.id;
      const policyTypeKey = req.query.policyType as string;

      if (!policyTypeKey) {
        return res.status(400).json({ message: "policyType query parameter is required" });
      }

      if (targetUserId !== user.id) {
        if (user.role === "admin") {
        } else if (user.role === "manager") {
          const scopedIds = await storage.getScopedUserIds(user);
          if (!scopedIds.has(targetUserId)) {
            return res.status(403).json({ message: "Not authorized to view this user's effective policy" });
          }
        } else {
          return res.status(403).json({ message: "Not authorized to view this user's effective policy" });
        }
      }

      let targetUser: User | undefined;
      if (targetUserId === user.id) {
        targetUser = user;
      } else {
        targetUser = await storage.getUser(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ message: "User not found" });
        }
      }

      const effectivePolicy = await getEffectivePolicy(
        targetUser.companyId,
        targetUserId,
        policyTypeKey,
        targetUser
      );

      if (!effectivePolicy) {
        const defaultRules = getDefaultRulesForType(policyTypeKey);
        return res.json({
          policyId: null,
          policyName: `Default ${policyTypeKey} policy`,
          policyTypeKey,
          assignmentLevel: "default",
          rules: defaultRules,
        });
      }

      res.json(effectivePolicy);
    } catch (error) {
      console.error("Error fetching effective policy:", error);
      handleRouteError(res, error, "Failed to fetch effective policy");
    }
  });

  // All policies that apply to a single employee, with every reason (source)
  // each one applies (direct + inherited via role/department/location/company/
  // employment type/pay type/global), real effective dates, and the viewed
  // employee's acknowledgment status. Gated on BOTH viewing employee details
  // and viewing policies; managers are additionally limited to their scope.
  app.get(
    "/api/users/:id/applicable-policies",
    requireAuth,
    requirePermission("users.view"),
    requirePermission("policies.view"),
    async (req: any, res) => {
      try {
        const actingUser = req.authUser as User;
        const targetUserId = String(req.params.id);

        if (targetUserId !== actingUser.id && actingUser.role !== "admin") {
          if (actingUser.role === "manager") {
            const scopedIds = await storage.getScopedUserIds(actingUser);
            if (!scopedIds.has(targetUserId)) {
              return res.status(403).json({ message: "Not authorized to view this employee's policies" });
            }
          } else {
            return res.status(403).json({ message: "Not authorized to view this employee's policies" });
          }
        }

        const targetUser =
          targetUserId === actingUser.id ? actingUser : await storage.getUser(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ message: "Employee not found" });
        }

        const applicable = await getApplicablePolicies(targetUser);

        const [companies, locations, departments, roles] = await Promise.all([
          storage.getAllCompanies(),
          storage.getAllLocations(),
          storage.getAllDepartments(),
          storage.getAllRoles(),
        ]);
        const companyNames = new Map(companies.map((c) => [c.id, c.name]));
        const locationNames = new Map(locations.map((l) => [l.id, l.name]));
        const departmentNames = new Map(departments.map((d) => [d.id, d.name]));
        const roleNames = new Map(roles.map((r) => [r.id, r.name]));

        const humanize = (v: string) =>
          v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        const labelForSource = (level: string, targetId: string | null): string => {
          switch (level) {
            case "employee":
              return "Directly assigned";
            case "role":
              return `Role: ${(targetId && roleNames.get(targetId)) || "Unknown role"}`;
            case "department":
              return `Department: ${(targetId && departmentNames.get(targetId)) || "Unknown department"}`;
            case "location":
              return `Location: ${(targetId && locationNames.get(targetId)) || "Unknown location"}`;
            case "division":
              return `Company: ${(targetId && companyNames.get(targetId)) || "Unknown company"}`;
            case "employment_type":
              return `Employment type: ${targetId ? humanize(targetId) : "Unknown"}`;
            case "pay_type":
              return `Pay type: ${targetId ? humanize(targetId) : "Unknown"}`;
            case "global":
              return "All employees";
            default:
              return humanize(level);
          }
        };

        const enriched = applicable.map((p) => ({
          ...p,
          sources: p.sources.map((s) => ({
            level: s.level,
            label: labelForSource(s.level, s.targetId),
            effectiveDate: s.effectiveDate,
          })),
        }));

        res.json(enriched);
      } catch (error) {
        console.error("Error fetching applicable policies:", error);
        handleRouteError(res, error, "Failed to fetch applicable policies");
      }
    },
  );

  // Self-service: an employee acknowledges a policy that applies to them and
  // requires acknowledgment. Consent-gated server-side — the policy must require
  // acknowledgment AND actually apply to the acting user.
  app.post("/api/policies/:id/acknowledge", requireAuth, async (req: any, res) => {
    try {
      const actingUser = req.authUser as User;
      const policyId = String(req.params.id);

      const policy = await storage.getPolicy(policyId);
      if (!policy) {
        return res.status(404).json({ message: "Policy not found" });
      }
      if (!policy.requiresAcknowledgment) {
        return res.status(400).json({ message: "This policy does not require acknowledgment" });
      }

      const applicable = await getApplicablePolicies(actingUser);
      const applies = applicable.find((p) => p.policyId === policyId);
      if (!applies) {
        return res.status(403).json({ message: "This policy does not apply to you" });
      }

      const ack = await storage.createPolicyAcknowledgment({
        policyId,
        userId: actingUser.id,
        policyVersion: policy.version,
      });

      await writeAuditLog({
        actorUserId: actingUser.id,
        action: "policy.acknowledged",
        targetId: policyId,
        targetType: "policy",
        newValue: { policyName: policy.name, policyVersion: policy.version },
        ...getAuditContext(req),
      });

      res.status(201).json(ack);
    } catch (error) {
      console.error("Error acknowledging policy:", error);
      handleRouteError(res, error, "Failed to acknowledge policy");
    }
  });

  app.get("/api/policy-defaults/:policyType", requireAuth, requirePermission("policies.view"), async (req, res) => {
    try {
      const defaults = getDefaultRulesForType(String(req.params.policyType));
      if (Object.keys(defaults).length === 0) {
        return res.status(404).json({ message: "Unknown policy type" });
      }
      res.json(defaults);
    } catch (error) {
      console.error("Error fetching policy defaults:", error);
      handleRouteError(res, error, "Failed to fetch policy defaults");
    }
  });

  const payrollBatchCreateSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    companyId: z.string().optional(),
    notes: z.string().optional(),
  });

  app.get("/api/payroll/exports", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const exports = await storage.getPayrollExports(companyId);

      const profileCache = new Map<string, Awaited<ReturnType<typeof storage.getEmploymentProfile>> | null>();
      const enriched = await Promise.all(exports.map(async (exp) => {
        const records = await storage.getPayrollBatchRecords(exp.id);
        let totalHours = 0;
        let totalOvertimeHours = 0;
        let totalEstimatedPay = 0;
        let totalBonusAmount = 0;
        let totalBonusHours = 0;
        const employeeIds = new Set<string>();

        for (const r of records) {
          const bonusHours = r.bonusHours || 0;
          const bonusAmount = r.bonusAmount || 0;
          const hours = (r.regularHours || 0) + (r.overtimeHours || 0) + (r.ptoHours || 0) + bonusHours;
          totalHours += hours;
          totalOvertimeHours += r.overtimeHours || 0;
          totalBonusAmount += bonusAmount;
          totalBonusHours += bonusHours;
          employeeIds.add(r.employeeId);

          if (!profileCache.has(r.employeeId)) {
            profileCache.set(r.employeeId, await storage.getEmploymentProfile(r.employeeId) || null);
          }
          const profile = profileCache.get(r.employeeId);
          let hourlyRate = 0;
          if (profile?.hourlyRate) hourlyRate = profile.hourlyRate;
          else if (profile?.dailySalary) hourlyRate = profile.dailySalary / 8;
          else if (profile?.weeklySalary) hourlyRate = profile.weeklySalary / 40;
          totalEstimatedPay += hours * hourlyRate + bonusAmount;
        }

        return {
          ...exp,
          totalHours: Math.round(totalHours * 100) / 100,
          totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
          totalEstimatedPay: Math.round(totalEstimatedPay * 100) / 100,
          totalBonusAmount: Math.round(totalBonusAmount * 100) / 100,
          totalBonusHours: Math.round(totalBonusHours * 100) / 100,
          employeeCount: employeeIds.size,
        };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching payroll exports:", error);
      handleRouteError(res, error, "Failed to fetch payroll exports");
    }
  });

  app.get("/api/payroll/exports/:id", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });
      res.json(exp);
    } catch (error) {
      console.error("Error fetching payroll export:", error);
      handleRouteError(res, error, "Failed to fetch payroll export");
    }
  });

  app.post("/api/payroll/exports", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    const peKey = `payroll:exports:${req.authUser?.id ?? "anon"}`;
    const peGate = shouldRun(peKey);
    if (!peGate.ok) {
      return res.status(202).json({
        message: `Payroll export rebuild cooling down. Try again in ${Math.ceil(peGate.retryAfterMs / 1000)}s.`,
        retryAfterMs: peGate.retryAfterMs,
      });
    }
    try {
      const parsed = payrollBatchCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payroll batch data", errors: parsed.error.flatten() });
      }

      const { startDate, endDate, companyId, notes } = parsed.data;
      const adminUser = req.authUser as User;

      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }

      const unresolvedExceptions = await storage.getPendingAttendanceExceptions();
      const attendanceRecords = await storage.getAttendanceByDateRange(startDate, endDate);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const missingPunches = attendanceRecords.filter(
        r => r.clockIn && !r.clockOut && r.status !== "in-progress"
      );

      const dateRangeExceptions = unresolvedExceptions.filter(
        e => e.exceptionDate >= startDate && e.exceptionDate <= endDate
      );

      if (dateRangeExceptions.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${dateRangeExceptions.length} unresolved attendance exception(s) in date range`,
          unresolvedExceptions: dateRangeExceptions.length,
        });
      }

      if (missingPunches.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${missingPunches.length} record(s) with missing clock-out in date range`,
          missingPunches: missingPunches.length,
        });
      }

      const unapprovedEdits = attendanceRecords.filter(r => !r.approved);
      if (unapprovedEdits.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${unapprovedEdits.length} unapproved attendance record(s) in date range`,
          unapprovedEdits: unapprovedEdits.length,
        });
      }

      const overlapping = await storage.getOverlappingPayrollExports(startDate, endDate, companyId);
      let overlapWarning: string | undefined;
      if (overlapping.length > 0) {
        overlapWarning = `Warning: ${overlapping.length} existing export(s) overlap with this date range`;
      }

      const timeOffRequests = await storage.getAllTimeOffRequests();
      const approvedTimeOff = timeOffRequests.filter(
        r => r.status === "approved" && r.requestCategory !== "cashout" && r.startDate <= endDate && r.endDate >= startDate
      );
      const approvedCashouts = timeOffRequests.filter(
        r => r.status === "approved" && r.requestCategory === "cashout" && r.startDate <= endDate && r.endDate >= startDate
      );

      // Group attendance punches by (employee, work date) so overtime /
      // double-time are split at the DAY level via the unified pay engine
      // (matching the timesheet & reports) instead of per-punch. One batch
      // record is written per employee-day.
      type DayGroup = { employeeId: string; workDate: string; punches: typeof attendanceRecords };
      const dayGroups = new Map<string, DayGroup>();
      for (const record of attendanceRecords) {
        const key = `${record.employeeId}__${record.workDate}`;
        let g = dayGroups.get(key);
        if (!g) {
          g = { employeeId: record.employeeId, workDate: record.workDate, punches: [] };
          dayGroups.set(key, g);
        }
        g.punches.push(record);
      }

      const totalRecordCount = dayGroups.size + approvedTimeOff.length + approvedCashouts.length;

      // Per-employee resolution caches: the frozen pay-engine snapshot, the raw
      // payroll rules (for bonus evaluation), the hourly rate, and the active
      // scheduled days (for holiday detection). Resolved once per employee.
      const empResolutionCache = new Map<string, {
        payCalc: PayCalcPolicy;
        payrollRules: Record<string, any>;
        rate: number;
        scheduledDays: number[];
        payrollCompanyId: string | null;
        payrollCompanyName: string | null;
      }>();
      // Small per-batch cache so resolving the payroll company name never
      // re-queries the same company across employees.
      const companyNameCache = new Map<string, string | null>();
      const resolveCompanyName = async (companyId: string | null): Promise<string | null> => {
        if (!companyId) return null;
        if (companyNameCache.has(companyId)) return companyNameCache.get(companyId)!;
        const company = await storage.getCompany(companyId);
        const name = company?.name ?? null;
        companyNameCache.set(companyId, name);
        return name;
      };
      const resolveEmp = async (employeeId: string) => {
        const cached = empResolutionCache.get(employeeId);
        if (cached) return cached;
        const empUser = userMap.get(employeeId);
        const [att, pay, pto] = await Promise.all([
          empUser ? getEffectivePolicy(empUser.companyId, employeeId, "attendance", empUser) : Promise.resolve(null),
          empUser ? getEffectivePolicy(empUser.companyId, employeeId, "payroll", empUser) : Promise.resolve(null),
          empUser ? getEffectivePolicy(empUser.companyId, employeeId, "pto", empUser) : Promise.resolve(null),
        ]);
        const payCalc = buildPayCalcPolicy(att?.rules, pay?.rules, pto?.rules, {
          attendance: att?.version ?? null,
          payroll: pay?.version ?? null,
        });
        const profile = await storage.getEmploymentProfile(employeeId);
        let rate = 0;
        if (profile) {
          if (profile.hourlyRate) rate = profile.hourlyRate;
          else if (profile.dailySalary) rate = profile.dailySalary / 8;
          else if (profile.weeklySalary) rate = profile.weeklySalary / 40;
        }
        const payrollCompanyId = profile?.payrollCompanyId ?? null;
        const payrollCompanyName = await resolveCompanyName(payrollCompanyId);
        const schedules = await storage.getEmployeeSchedules(employeeId);
        const resolved = {
          payCalc,
          payrollRules: (pay?.rules as Record<string, any>) || DEFAULT_PAYROLL_RULES,
          rate,
          scheduledDays: schedules.filter(s => s.isActive).map(s => s.dayOfWeek),
          payrollCompanyId,
          payrollCompanyName,
        };
        empResolutionCache.set(employeeId, resolved);
        return resolved;
      };
      const getDayOfWeekForDate = (dateStr: string): number => {
        const parts = dateStr.split("-");
        return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))).getUTCDay();
      };

      // Payroll refreshes the canonical attendance ledger for the batch range so
      // the durable rows that live surfaces read stay current, then computes its
      // OWN weekly-aware split below (over the exact batch period, grouped by
      // workweek) and FREEZES the policy snapshot onto each batch record for
      // closed-period stability. Same engine, computed once per surface scope.
      const ledgerEmployees = Array.from(new Set([...dayGroups.values()].map(g => g.employeeId)))
        .map(id => userMap.get(id))
        .filter((u): u is User => !!u);
      await getLedgerForEmployees(ledgerEmployees, startDate, endDate);

      const payrollExport = await db.transaction(async (tx) => {
        const [created] = await tx.insert(payrollExportsTable).values({
          startDate,
          endDate,
          companyId: companyId || null,
          status: "draft",
          notes: notes || null,
          createdBy: adminUser.id,
          recordCount: totalRecordCount,
          exportedAt: null,
          exportedBy: null,
          lockedAt: null,
          lockedBy: null,
          reopenedAt: null,
          reopenedBy: null,
        }).returning();

        // Group employee-days by employee so WEEKLY overtime can be applied
        // across the workweek (daily OT/DT first, then regular hours over the
        // weekly threshold reclassified to OT). The distribution is deterministic
        // so payroll reconciliation reproduces the exact same per-day rows.
        const groupsByEmployee = new Map<string, DayGroup[]>();
        for (const g of dayGroups.values()) {
          const arr = groupsByEmployee.get(g.employeeId);
          if (arr) arr.push(g);
          else groupsByEmployee.set(g.employeeId, [g]);
        }

        for (const [employeeId, groups] of groupsByEmployee) {
          const { payCalc, payrollRules, rate, scheduledDays, payrollCompanyId, payrollCompanyName } = await resolveEmp(employeeId);

          type DayMeta = {
            workDate: string;
            dayHours: number;
            isHoliday: boolean;
            primaryPunchId: string | null;
            hasIssue: boolean;
            bonusAmount: number;
            bonusHours: number;
            bonusDescription: string | null;
          };
          const dayMetas: DayMeta[] = [];
          for (const g of groups) {
            let dayHours = 0;
            let earliestClockIn: Date | null = null;
            let earliestRounded: Date | string | null = null;
            let primaryPunchId: string | null = null;
            let hasIssue = false;
            for (const p of g.punches) {
              dayHours += p.hoursWorked || 0;
              if (!p.clockIn || (!p.clockOut && p.status !== "in-progress")) hasIssue = true;
              if (p.clockIn) {
                const t = new Date(p.clockIn);
                if (!earliestClockIn || t < earliestClockIn) {
                  earliestClockIn = t;
                  earliestRounded = p.roundedClockIn ?? p.clockIn;
                  primaryPunchId = p.id;
                }
              }
              if (primaryPunchId === null) primaryPunchId = p.id;
            }
            dayHours = round2(dayHours);

            // Holiday = worked on a non-scheduled day (mirrors the CSV export's
            // pay-type logic). When the policy excludes holiday hours from OT,
            // the engine keeps them all regular AND out of the weekly threshold.
            const isHoliday = scheduledDays.length > 0 && !scheduledDays.includes(getDayOfWeekForDate(g.workDate));
            const bonusResult = evaluateDayOfWeekBonuses(g.workDate, dayHours, payrollRules);
            const earlyResult = evaluateEarlyArrivalBonuses(g.workDate, earliestRounded, dayHours, payrollRules);
            const combinedBonusAmount = round2(bonusResult.bonusAmount + earlyResult.bonusAmount);
            const combinedDescriptions = [...bonusResult.descriptions, ...earlyResult.descriptions];

            dayMetas.push({
              workDate: g.workDate,
              dayHours,
              isHoliday,
              primaryPunchId,
              hasIssue,
              bonusAmount: combinedBonusAmount,
              bonusHours: bonusResult.bonusHours,
              bonusDescription: combinedDescriptions.length > 0 ? combinedDescriptions.join("; ") : null,
            });
          }

          // The batch's per-day split is computed via the weekly-aware engine over
          // the WHOLE batch period so regular hours over the weekly threshold are
          // reclassified into overtime (grouped by workweek). This is the same
          // engine the canonical ledger materializes; payroll computes it directly
          // here over the exact batch range and FREEZES the snapshot below for
          // closed-period stability.
          const weekly = computeWeeklyHours(
            dayMetas.map(d => ({ date: d.workDate, hours: d.dayHours, isHoliday: d.isHoliday })),
            payCalc,
          );
          const splitByDate = new Map(weekly.days.map(d => [d.date, d]));

          for (const meta of dayMetas) {
            const split = splitByDate.get(meta.workDate);
            await tx.insert(payrollBatchRecordsTable).values({
              payrollExportId: created.id,
              employeeId,
              punchLogId: meta.primaryPunchId,
              timeOffRequestId: null,
              recordType: "attendance",
              workDate: meta.workDate,
              regularHours: split ? split.regularHours : 0,
              overtimeHours: split ? split.overtimeHours : 0,
              doubleTimeHours: split ? split.doubleTimeHours : 0,
              ptoHours: 0,
              otThresholdDaily: payCalc.otThresholdDaily,
              doubleTimeThresholdDaily: payCalc.doubleTimeThresholdDaily,
              overtimeMultiplier: payCalc.overtimeMultiplier,
              doubleTimeMultiplier: payCalc.doubleTimeMultiplier,
              hourlyRate: rate,
              policyVersion: payCalc.payrollPolicyVersion,
              autoCalculateOt: payCalc.autoCalculateOT,
              overtimeEnabled: payCalc.overtimeEnabled,
              doubleTimeEnabled: payCalc.doubleTimeEnabled,
              holidayOtExclusion: payCalc.holidayOtExclusion,
              isHoliday: meta.isHoliday,
              otThresholdWeekly: payCalc.otThresholdWeekly,
              weeklyOvertimeEnabled: payCalc.weeklyOvertimeEnabled,
              workweekStartDay: payCalc.workweekStartDay,
              payrollCompanyId,
              payrollCompanyName,
              bonusAmount: meta.bonusAmount,
              bonusHours: meta.bonusHours,
              bonusDescription: meta.bonusDescription,
              hasIssues: meta.hasIssue,
              issueDescription: meta.hasIssue ? `Missing punch data on ${meta.workDate}` : null,
            });
          }
        }

        for (const tor of approvedTimeOff) {
          const ptoHours = tor.hoursRequested || 8;
          const effectiveStart = tor.startDate > startDate ? tor.startDate : startDate;
          const { rate, payrollCompanyId, payrollCompanyName } = await resolveEmp(tor.userId);

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: tor.userId,
            punchLogId: null,
            timeOffRequestId: tor.id,
            recordType: "pto",
            workDate: effectiveStart,
            regularHours: 0,
            overtimeHours: 0,
            doubleTimeHours: 0,
            ptoHours,
            hourlyRate: rate,
            payrollCompanyId,
            payrollCompanyName,
            hasIssues: false,
            issueDescription: null,
          });
        }

        for (const co of approvedCashouts) {
          const cashoutHours = co.hoursRequested || 8;
          const { rate, payrollCompanyId, payrollCompanyName } = await resolveEmp(co.userId);

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: co.userId,
            punchLogId: null,
            timeOffRequestId: co.id,
            recordType: "pto_cashout",
            workDate: co.startDate,
            regularHours: 0,
            overtimeHours: 0,
            doubleTimeHours: 0,
            ptoHours: cashoutHours,
            hourlyRate: rate,
            payrollCompanyId,
            payrollCompanyName,
            hasIssues: false,
            issueDescription: null,
          });
        }

        return created;
      });

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: payrollExport.id,
        action: "payroll_export.created",
        newValue: { startDate, endDate, recordCount: totalRecordCount },
        ...auditCtx,
      });

      res.status(201).json({
        ...payrollExport,
        recordCount: totalRecordCount,
        overlapWarning,
      });
    } catch (error) {
      console.error("Error creating payroll batch:", error);
      handleRouteError(res, error, "Failed to create payroll batch");
    }
  });

  app.get("/api/payroll/exports/:id/records", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(String(req.params.id));
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      // Resolve a payroll-company name per record: prefer the snapshot frozen at
      // batch creation; fall back to the employee's current employment profile
      // for legacy rows (created before the snapshot existed).
      const companyNameCache = new Map<string, string | null>();
      const profilePayrollCompanyCache = new Map<string, string | null>();
      const resolveSnapshotFallbackName = async (r: typeof records[number]): Promise<string | null> => {
        if (r.payrollCompanyName) return r.payrollCompanyName;
        if (r.payrollCompanyId) {
          if (!companyNameCache.has(r.payrollCompanyId)) {
            const c = await storage.getCompany(r.payrollCompanyId);
            companyNameCache.set(r.payrollCompanyId, c?.name ?? null);
          }
          return companyNameCache.get(r.payrollCompanyId)!;
        }
        if (!profilePayrollCompanyCache.has(r.employeeId)) {
          const profile = await storage.getEmploymentProfile(r.employeeId);
          let name: string | null = null;
          if (profile?.payrollCompanyId) {
            const c = await storage.getCompany(profile.payrollCompanyId);
            name = c?.name ?? null;
          }
          profilePayrollCompanyCache.set(r.employeeId, name);
        }
        return profilePayrollCompanyCache.get(r.employeeId)!;
      };

      const enriched = await Promise.all(records.map(async r => {
        const user = userMap.get(r.employeeId);
        return {
          ...r,
          employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
          payrollCompanyName: await resolveSnapshotFallbackName(r),
        };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching batch records:", error);
      handleRouteError(res, error, "Failed to fetch batch records");
    }
  });

  app.get("/api/payroll/exports/:id/summary", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(String(req.params.id));
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      // Resolve a per-record hourly rate: prefer the snapshot frozen at batch
      // creation, fall back to the current employment profile for legacy rows
      // (created before the snapshot existed).
      const rateFallbackCache = new Map<string, number>();
      const resolveRate = async (r: typeof records[number]): Promise<number> => {
        if (r.hourlyRate != null) return r.hourlyRate;
        if (!rateFallbackCache.has(r.employeeId)) {
          const profile = await storage.getEmploymentProfile(r.employeeId);
          let rate = 0;
          if (profile) {
            if (profile.hourlyRate) rate = profile.hourlyRate;
            else if (profile.dailySalary) rate = profile.dailySalary / 8;
            else if (profile.weeklySalary) rate = profile.weeklySalary / 40;
          }
          rateFallbackCache.set(r.employeeId, rate);
        }
        return rateFallbackCache.get(r.employeeId)!;
      };

      const summary = new Map<string, { employeeId: string; employeeName: string; regularHours: number; overtimeHours: number; doubleTimeHours: number; ptoHours: number; bonusHours: number; bonusAmount: number; grossPay: number; hasIssues: boolean }>();

      for (const r of records) {
        if (!summary.has(r.employeeId)) {
          const user = userMap.get(r.employeeId);
          summary.set(r.employeeId, {
            employeeId: r.employeeId,
            employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
            regularHours: 0,
            overtimeHours: 0,
            doubleTimeHours: 0,
            ptoHours: 0,
            bonusHours: 0,
            bonusAmount: 0,
            grossPay: 0,
            hasIssues: false,
          });
        }
        const emp = summary.get(r.employeeId)!;
        const reg = r.regularHours || 0;
        const ot = r.overtimeHours || 0;
        const dt = r.doubleTimeHours || 0;
        const pto = r.ptoHours || 0;
        const bonus = r.bonusAmount || 0;
        emp.regularHours += reg;
        emp.overtimeHours += ot;
        emp.doubleTimeHours += dt;
        emp.ptoHours += pto;
        emp.bonusHours += r.bonusHours || 0;
        emp.bonusAmount += bonus;
        // Gross pay applies the (snapshotted) OT/DT multipliers; PTO pays at base.
        const rate = await resolveRate(r);
        const otMult = r.overtimeMultiplier ?? DEFAULT_PAYROLL_RULES.overtimeMultiplier;
        const dtMult = r.doubleTimeMultiplier ?? DEFAULT_PAYROLL_RULES.doubleTimeMultiplier;
        const worked = computeGrossPay({ regularHours: reg, overtimeHours: ot, doubleTimeHours: dt }, rate, { overtimeMultiplier: otMult, doubleTimeMultiplier: dtMult });
        emp.grossPay = round2(emp.grossPay + worked + pto * rate + bonus);
        if (r.hasIssues) emp.hasIssues = true;
      }

      res.json(Array.from(summary.values()));
    } catch (error) {
      console.error("Error fetching payroll summary:", error);
      handleRouteError(res, error, "Failed to fetch payroll summary");
    }
  });

  app.post("/api/payroll/exports/:id/export-csv", requireAuth, requirePermission("payroll.export"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status === "locked") {
        return res.status(400).json({ message: "Cannot export a locked payroll batch. Reopen it first." });
      }

      const records = await storage.getPayrollBatchRecords(String(req.params.id));
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const allDepartments = await storage.getAllDepartments();
      const deptMap = new Map(allDepartments.map(d => [d.id, d.name]));

      const profileCache = new Map<string, Awaited<ReturnType<typeof storage.getEmploymentProfile>> | null>();
      const scheduleCache = new Map<string, Awaited<ReturnType<typeof storage.getEmployeeSchedules>>>();

      const getProfile = async (userId: string) => {
        if (!profileCache.has(userId)) {
          profileCache.set(userId, await storage.getEmploymentProfile(userId) || null);
        }
        return profileCache.get(userId);
      };

      const getSchedules = async (userId: string) => {
        if (!scheduleCache.has(userId)) {
          scheduleCache.set(userId, await storage.getEmployeeSchedules(userId));
        }
        return scheduleCache.get(userId)!;
      };

      // Resolve the payroll-company name for a record: prefer the snapshot frozen
      // at batch creation, fall back to the live employment profile for legacy
      // rows so historical exports never drift when an employee's payroll company
      // is later changed.
      const companyNameCache = new Map<string, string | null>();
      const resolveCompanyName = async (companyId: string | null | undefined): Promise<string | null> => {
        if (!companyId) return null;
        if (!companyNameCache.has(companyId)) {
          const c = await storage.getCompany(companyId);
          companyNameCache.set(companyId, c?.name ?? null);
        }
        return companyNameCache.get(companyId)!;
      };
      const getPayrollCompanyName = async (r: typeof records[number], profile: Awaited<ReturnType<typeof getProfile>>): Promise<string> => {
        if (r.payrollCompanyName) return r.payrollCompanyName;
        const fromSnapshotId = await resolveCompanyName(r.payrollCompanyId);
        if (fromSnapshotId) return fromSnapshotId;
        const fromProfile = await resolveCompanyName(profile?.payrollCompanyId);
        return fromProfile ?? "";
      };

      const formatDateWorked = (dateStr: string): string => {
        const parts = dateStr.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const dayNum = parseInt(parts[2], 10);
        const d = new Date(Date.UTC(year, month - 1, dayNum));
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayName = days[d.getUTCDay()];
        const mm = String(month).padStart(2, "0");
        const dd = String(dayNum).padStart(2, "0");
        return `${dayName}, ${mm}/${dd}/${year}`;
      };

      const getDayOfWeek = (dateStr: string): number => {
        const parts = dateStr.split("-");
        const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        return d.getUTCDay();
      };

      const escapeCSV = (val: string): string => {
        return `"${val.replace(/"/g, '""')}"`;
      };

      const formatAmountCurrency = (val: number): string => {
        const parts = val.toFixed(2).split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `"$${parts.join(".")}"`;
      };

      const formatHoursVal = (val: number): string => {
        return val.toFixed(2);
      };

      // Identify which punch logs in this batch's range were created/updated via an approved correction.
      const approvedExceptionsForBatch = await db
        .select({ punchLogId: attendanceExceptions.punchLogId })
        .from(attendanceExceptions)
        .where(and(
          eq(attendanceExceptions.status, "approved"),
          isNotNull(attendanceExceptions.punchLogId),
        ));
      const correctedPunchLogIds = new Set(
        approvedExceptionsForBatch.map(e => e.punchLogId).filter(Boolean) as string[]
      );

      type DayRow = { employeeName: string; taxClassification: string; payrollCompany: string; amount: number; payType: string; department: string; paidHours: number; dateWorked: string; sortDate: string; wasCorrected: boolean; bonusAmount: number; bonusDescriptions: string[] };
      const employeeRecords = new Map<string, Map<string, DayRow>>();

      for (const r of records) {
        const user = userMap.get(r.employeeId);
        const employeeName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown";
        const department = user?.departmentId ? (deptMap.get(user.departmentId) || "") : "";
        const profile = await getProfile(r.employeeId);
        const schedules = await getSchedules(r.employeeId);
        const payrollCompany = await getPayrollCompanyName(r, profile);

        // Prefer the hourly rate frozen onto the record at batch creation so
        // historical exports never drift when a profile's pay rate later
        // changes; fall back to the current profile for legacy rows.
        let hourlyRate = r.hourlyRate ?? 0;
        if (r.hourlyRate == null && profile) {
          if (profile.hourlyRate) {
            hourlyRate = profile.hourlyRate;
          } else if (profile.dailySalary) {
            hourlyRate = profile.dailySalary / 8;
          } else if (profile.weeklySalary) {
            hourlyRate = profile.weeklySalary / 40;
          }
        }

        const bonusHours = r.bonusHours || 0;
        const bonusAmount = r.bonusAmount || 0;
        const regHours = r.regularHours || 0;
        const otHours = r.overtimeHours || 0;
        const dtHours = r.doubleTimeHours || 0;
        const ptoHours = r.ptoHours || 0;
        // Paid hours include OT/DT/PTO/bonus hours at face value; the dollar
        // amount applies the (snapshotted) OT/DT premium multipliers.
        const totalHours = regHours + otHours + dtHours + ptoHours + bonusHours;
        const otMult = r.overtimeMultiplier ?? DEFAULT_PAYROLL_RULES.overtimeMultiplier;
        const dtMult = r.doubleTimeMultiplier ?? DEFAULT_PAYROLL_RULES.doubleTimeMultiplier;
        const workedPay = computeGrossPay(
          { regularHours: regHours, overtimeHours: otHours, doubleTimeHours: dtHours },
          hourlyRate,
          { overtimeMultiplier: otMult, doubleTimeMultiplier: dtMult },
        );
        const amount = round2(workedPay + ptoHours * hourlyRate + bonusAmount);

        const jsDayOfWeek = getDayOfWeek(r.workDate);
        const scheduledDays = schedules.filter(s => s.isActive).map(s => s.dayOfWeek);
        let payType = "Regular";
        if (r.recordType === "pto_cashout") {
          payType = "PTO Cash-Out";
        } else if (r.recordType === "pto") {
          payType = "Regular";
        } else if (profile?.payType === "contractual") {
          payType = "Contractual";
        } else if (scheduledDays.length > 0 && !scheduledDays.includes(jsDayOfWeek)) {
          payType = "Holiday";
        }

        const recCorrected = !!(r.punchLogId && correctedPunchLogIds.has(r.punchLogId));

        if (!employeeRecords.has(r.employeeId)) {
          employeeRecords.set(r.employeeId, new Map());
        }
        const empDays = employeeRecords.get(r.employeeId)!;
        const dateKey = r.workDate;
        const trimmedBonusDesc = (r.bonusDescription || "").trim();
        if (empDays.has(dateKey)) {
          const existing = empDays.get(dateKey)!;
          existing.amount += amount;
          existing.paidHours += totalHours;
          existing.bonusAmount += bonusAmount;
          if (trimmedBonusDesc) existing.bonusDescriptions.push(trimmedBonusDesc);
          if (payType === "Holiday") existing.payType = "Holiday";
          if (recCorrected) existing.wasCorrected = true;
        } else {
          empDays.set(dateKey, {
            employeeName,
            taxClassification: profile?.taxClassification || "W-2",
            payrollCompany,
            amount,
            payType,
            department,
            paidHours: totalHours,
            dateWorked: formatDateWorked(r.workDate),
            sortDate: r.workDate,
            wasCorrected: recCorrected,
            bonusAmount,
            bonusDescriptions: trimmedBonusDesc ? [trimmedBonusDesc] : [],
          });
        }
      }

      const overlapping = await storage.getOverlappingPayrollExports(exp.startDate, exp.endDate, exp.companyId || undefined);
      const previousExports = overlapping.filter(o => o.id !== exp.id);
      let reexportWarning: string | undefined;
      if (previousExports.length > 0) {
        reexportWarning = `Warning: Re-exporting data that overlaps with ${previousExports.length} previous export(s)`;
      }

      let csv = `Pay Period: ${formatDateWorked(exp.startDate)} - ${formatDateWorked(exp.endDate)}\n`;
      csv += "Employee Name,Tax Classification,Payroll Company,Amount,Pay Type,Department,Paid Hours,Date Worked,Corrected,Bonus Amount,Bonus Description\n";

      for (const [, dayMap] of employeeRecords) {
        const rows = Array.from(dayMap.values()).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
        let totalAmount = 0;
        let totalPaidHours = 0;
        let totalBonusAmount = 0;

        for (const row of rows) {
          const bonusAmtCell = row.bonusAmount > 0 ? formatAmountCurrency(row.bonusAmount) : "";
          const bonusDescCell = row.bonusDescriptions.length > 0 ? escapeCSV(row.bonusDescriptions.join("; ")) : "";
          csv += `${escapeCSV(row.employeeName)},${escapeCSV(row.taxClassification)},${escapeCSV(row.payrollCompany)},${formatAmountCurrency(row.amount)},${escapeCSV(row.payType)},${escapeCSV(row.department)},${formatHoursVal(row.paidHours)},${escapeCSV(row.dateWorked)},${row.wasCorrected ? "Yes" : ""},${bonusAmtCell},${bonusDescCell}\n`;
          totalAmount += row.amount;
          totalPaidHours += row.paidHours;
          totalBonusAmount += row.bonusAmount;
        }

        const empName = rows[0].employeeName;
        const taxClass = rows[0].taxClassification;
        const payrollCompany = rows[0].payrollCompany;
        const totalBonusCell = totalBonusAmount > 0 ? formatAmountCurrency(totalBonusAmount) : "";
        csv += `${escapeCSV(empName + " - Paid Totals")},${escapeCSV(taxClass)},${escapeCSV(payrollCompany)},${formatAmountCurrency(totalAmount)},,,${formatHoursVal(totalPaidHours)},,,${totalBonusCell},\n`;
      }

      const adminUser = req.authUser as User;
      await storage.updatePayrollExport(exp.id, {
        status: "exported",
        exportedAt: new Date(),
        exportedBy: adminUser.id,
      });

      if (reexportWarning) {
        res.setHeader("X-Payroll-Overlap-Warning", reexportWarning);
      }

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.exported",
        newValue: { status: "exported", employeeCount: employeeRecords.size },
        ...auditCtx,
      });

      const ledgerCtx = getLedgerContext(req);
      await Promise.all(
        Array.from(employeeRecords.keys()).map((employeeId) =>
          writeLedgerEntry({
            category: "payroll",
            eventType: "payroll_exported",
            employeeId,
            actorUserId: adminUser.id,
            entityType: "payroll_export",
            entityId: exp.id,
            beforeValue: null,
            afterValue: { status: "exported" },
            context: { startDate: exp.startDate, endDate: exp.endDate },
            source: "admin",
            ...ledgerCtx,
          }),
        ),
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="payroll_${exp.startDate}_to_${exp.endDate}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payroll CSV:", error);
      handleRouteError(res, error, "Failed to export payroll CSV");
    }
  });

  // Drift detection: compare each batch record's frozen snapshot against a fresh
  // recompute of the current source data (hours / PTO / bonus). Strictly
  // read-only — never mutates the snapshot. Recomputed on demand. An audit entry
  // is written each time a check runs so there's a record of who looked.
  app.get("/api/payroll/exports/:id/drift", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    try {
      const result = await computePayrollDrift(String(req.params.id));
      if (!result) return res.status(404).json({ message: "Payroll export not found" });

      const adminUser = req.authUser as User;
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: result.exportId,
        action: "payroll_export.drift_checked",
        newValue: { driftStatus: result.driftStatus, changedCount: result.changedCount },
        ...auditCtx,
      });

      res.json(result);
    } catch (error) {
      console.error("Error checking payroll drift:", error);
      handleRouteError(res, error, "Failed to check payroll drift");
    }
  });

  app.post("/api/payroll/exports/:id/lock", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status !== "exported") {
        return res.status(400).json({ message: "Only exported batches can be locked" });
      }

      const adminUser = req.authUser as User;

      // Guard against locking a batch whose source data has drifted since export.
      // The caller must explicitly acknowledge the drift to proceed; otherwise we
      // return 409 with the drift summary so the UI can warn before locking.
      const acknowledgeDrift = req.body?.acknowledgeDrift === true;
      const drift = await computePayrollDrift(exp.id);
      const hasDrift = drift?.driftStatus === "changed";
      if (hasDrift && !acknowledgeDrift) {
        return res.status(409).json({
          message: `Cannot lock: ${drift!.changedCount} record(s) no longer match the current source data.`,
          driftStatus: drift!.driftStatus,
          changedCount: drift!.changedCount,
          requiresAcknowledgement: true,
        });
      }

      const updated = await storage.updatePayrollExport(exp.id, {
        status: "locked",
        lockedAt: new Date(),
        lockedBy: adminUser.id,
      });

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: hasDrift ? "payroll_export.locked_with_drift" : "payroll_export.locked",
        oldValue: { status: "exported" },
        newValue: hasDrift
          ? { status: "locked", acknowledgedDrift: true, changedCount: drift!.changedCount }
          : { status: "locked" },
        ...auditCtx,
      });

      const lockRecords = await storage.getPayrollBatchRecords(exp.id);
      const lockEmployeeIds = Array.from(new Set(lockRecords.map(r => r.employeeId)));
      const lockLedgerCtx = getLedgerContext(req);
      await Promise.all(
        lockEmployeeIds.map((employeeId) =>
          writeLedgerEntry({
            category: "payroll",
            eventType: "payroll_locked",
            employeeId,
            actorUserId: adminUser.id,
            entityType: "payroll_export",
            entityId: exp.id,
            beforeValue: { status: "exported" },
            afterValue: { status: "locked" },
            context: { startDate: exp.startDate, endDate: exp.endDate },
            source: "admin",
            ...lockLedgerCtx,
          }),
        ),
      );

      res.json(updated);
    } catch (error) {
      console.error("Error locking payroll batch:", error);
      handleRouteError(res, error, "Failed to lock payroll batch");
    }
  });

  app.post("/api/payroll/exports/:id/reopen", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status !== "locked" && exp.status !== "exported") {
        return res.status(400).json({ message: "Only locked or exported batches can be reopened" });
      }

      const adminUser = req.authUser as User;
      const updated = await storage.updatePayrollExport(exp.id, {
        status: "reopened",
        reopenedAt: new Date(),
        reopenedBy: adminUser.id,
      });

      const auditCtx = getAuditContext(req);
      const prevStatus = exp.status;
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.reopened",
        oldValue: { status: prevStatus },
        newValue: { status: "reopened" },
        ...auditCtx,
      });

      const reopenRecords = await storage.getPayrollBatchRecords(exp.id);
      const reopenEmployeeIds = Array.from(new Set(reopenRecords.map(r => r.employeeId)));
      const reopenLedgerCtx = getLedgerContext(req);
      await Promise.all(
        reopenEmployeeIds.map((employeeId) =>
          writeLedgerEntry({
            category: "payroll",
            eventType: "payroll_reopened",
            employeeId,
            actorUserId: adminUser.id,
            entityType: "payroll_export",
            entityId: exp.id,
            beforeValue: { status: prevStatus },
            afterValue: { status: "reopened" },
            context: { startDate: exp.startDate, endDate: exp.endDate },
            source: "admin",
            ...reopenLedgerCtx,
          }),
        ),
      );

      res.json(updated);
    } catch (error) {
      console.error("Error reopening payroll batch:", error);
      handleRouteError(res, error, "Failed to reopen payroll batch");
    }
  });

  app.get("/api/payroll/exports/:id/adjustments", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(String(req.params.id));
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const adjustments = await storage.getPayrollAdjustmentsByExport(String(req.params.id));
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching payroll adjustments:", error);
      handleRouteError(res, error, "Failed to fetch payroll adjustments");
    }
  });

  app.get("/api/payroll/adjustments/pending", requireAuth, requirePermission("payroll.view_all"), async (_req, res) => {
    try {
      const adjustments = await storage.getPendingPayrollAdjustments();
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching pending adjustments:", error);
      handleRouteError(res, error, "Failed to fetch pending adjustments");
    }
  });

  app.post("/api/payroll/adjustments/:id/acknowledge", requireAuth, requirePermission("payroll.manage"), async (req: any, res) => {
    try {
      const adjustment = await storage.getPayrollAdjustment(String(req.params.id));
      if (!adjustment) return res.status(404).json({ message: "Adjustment not found" });

      const adminUser = req.authUser as User;
      const updated = await storage.updatePayrollAdjustment(adjustment.id, {
        status: "acknowledged",
        reviewedBy: adminUser.id,
        reviewedAt: new Date(),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error acknowledging adjustment:", error);
      handleRouteError(res, error, "Failed to acknowledge adjustment");
    }
  });

  app.get("/api/payroll/overlap-check", requireAuth, requirePermission("payroll.view_all"), async (req, res) => {
    try {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const companyId = req.query.companyId as string | undefined;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const overlapping = await storage.getOverlappingPayrollExports(startDate, endDate, companyId);
      res.json({
        hasOverlap: overlapping.length > 0,
        overlappingExports: overlapping,
      });
    } catch (error) {
      console.error("Error checking overlap:", error);
      handleRouteError(res, error, "Failed to check overlap");
    }
  });

  // -----------------------------------------------------------------------
  // Recovery & reconciliation tools (attendance, PTO, payroll)
  // Admin-only, permission-gated. compute* endpoints are read-only diff
  // previews; apply* endpoints re-derive server-side and audit-log the write.
  // -----------------------------------------------------------------------
  const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

  app.get("/api/reconciliation/attendance", requireAuth, requireRole("admin"), requirePermission("reconciliation.run"), async (req, res) => {
    try {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
        return res.status(400).json({ message: "startDate and endDate (YYYY-MM-DD) are required" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "startDate must be on or before endDate" });
      }
      const result = await computeAttendanceReconciliation(startDate, endDate);
      res.json(result);
    } catch (error) {
      console.error("Error computing attendance reconciliation:", error);
      handleRouteError(res, error, "Failed to compute attendance reconciliation");
    }
  });

  app.post("/api/reconciliation/attendance/apply", requireAuth, requireRole("admin"), requirePermission("reconciliation.run"), async (req: any, res) => {
    try {
      const ids = req.body?.punchLogIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id: unknown) => typeof id === "string")) {
        return res.status(400).json({ message: "punchLogIds (non-empty string array) is required" });
      }
      const actor = req.authUser as User;
      const result = await applyAttendanceReconciliation(ids, actor.id, getAuditContext(req));
      res.json(result);
    } catch (error) {
      console.error("Error applying attendance reconciliation:", error);
      handleRouteError(res, error, "Failed to apply attendance reconciliation");
    }
  });

  app.get("/api/reconciliation/pto", requireAuth, requireRole("admin"), requirePermission("reconciliation.run"), async (req, res) => {
    try {
      const yearRaw = req.query.year as string | undefined;
      const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ message: "year must be a valid 4-digit year" });
      }
      const result = await computePtoReconciliation(year);
      res.json(result);
    } catch (error) {
      console.error("Error computing PTO reconciliation:", error);
      handleRouteError(res, error, "Failed to compute PTO reconciliation");
    }
  });

  app.post("/api/reconciliation/pto/apply", requireAuth, requireRole("admin"), requirePermission("reconciliation.run"), async (req: any, res) => {
    try {
      const ids = req.body?.userIds;
      const yearRaw = req.body?.year;
      const year = typeof yearRaw === "number" ? yearRaw : parseInt(String(yearRaw), 10);
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id: unknown) => typeof id === "string")) {
        return res.status(400).json({ message: "userIds (non-empty string array) is required" });
      }
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ message: "year must be a valid 4-digit year" });
      }
      const actor = req.authUser as User;
      const result = await applyPtoReconciliation(ids, year, actor.id, getAuditContext(req));
      res.json(result);
    } catch (error) {
      console.error("Error applying PTO reconciliation:", error);
      handleRouteError(res, error, "Failed to apply PTO reconciliation");
    }
  });

  app.get("/api/reconciliation/payroll/:exportId", requireAuth, requireRole("admin"), requirePermission("reconciliation.run"), async (req, res) => {
    try {
      const result = await computePayrollVerification(String(req.params.exportId));
      if (!result) return res.status(404).json({ message: "Payroll export not found" });
      res.json(result);
    } catch (error) {
      console.error("Error verifying payroll export:", error);
      handleRouteError(res, error, "Failed to verify payroll export");
    }
  });

  app.get("/api/alerts", requireAuth, requirePermission("alerts.view"), requestCache({ scope: "user" }), async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.type) filters.type = req.query.type as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.severity) filters.severity = req.query.severity as string;
      const alerts = await storage.getAllSystemAlerts(filters);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const enriched = alerts.map(a => ({
        ...a,
        employeeName: a.employeeId ? (() => {
          const u = userMap.get(a.employeeId);
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
        })() : null,
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      handleRouteError(res, error, "Failed to fetch alerts");
    }
  });

  app.post("/api/alerts/detect", requireAuth, requirePermission("alerts.manage"), async (req: any, res) => {
    try {
      const detected = await runAlertDetection();
      const created = [];
      for (const alert of detected) {
        const existing = await storage.getAllSystemAlerts({ type: alert.type, status: "open" });
        const isDuplicate = existing.some(e =>
          e.employeeId === alert.employeeId && e.message === alert.message
        );
        if (!isDuplicate) {
          const saved = await storage.createSystemAlert({
            type: alert.type,
            severity: alert.severity,
            status: "open",
            employeeId: alert.employeeId,
            message: alert.message,
            details: alert.details,
          });
          created.push(saved);
        }
      }
      res.json({ detected: detected.length, created: created.length, alerts: created });
    } catch (error) {
      console.error("Error running alert detection:", error);
      handleRouteError(res, error, "Failed to run alert detection");
    }
  });

  app.post("/api/alerts/:id/acknowledge", requireAuth, requirePermission("alerts.manage"), async (req: any, res) => {
    try {
      const alert = await storage.getSystemAlert(String(req.params.id));
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      const updated = await storage.updateSystemAlert(String(req.params.id), {
        status: "acknowledged",
        acknowledgedBy: req.authUser.id,
        acknowledgedAt: new Date(),
      });
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "system_alert",
        targetId: String(req.params.id),
        action: "alert.acknowledged",
        oldValue: { status: alert.status },
        newValue: { status: "acknowledged" },
        ...auditCtx,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error acknowledging alert:", error);
      handleRouteError(res, error, "Failed to acknowledge alert");
    }
  });

  app.post("/api/alerts/:id/resolve", requireAuth, requirePermission("alerts.manage"), async (req: any, res) => {
    try {
      const alert = await storage.getSystemAlert(String(req.params.id));
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      const updated = await storage.updateSystemAlert(String(req.params.id), {
        status: "resolved",
        resolvedBy: req.authUser.id,
        resolvedAt: new Date(),
      });
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "system_alert",
        targetId: String(req.params.id),
        action: "alert.resolved",
        oldValue: { status: alert.status },
        newValue: { status: "resolved" },
        ...auditCtx,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error resolving alert:", error);
      handleRouteError(res, error, "Failed to resolve alert");
    }
  });

  app.get("/api/audit-logs/filtered", requireAuth, requirePermission("audit.view"), requestCache({ scope: "user" }), async (req, res) => {
    try {
      const filters = {
        actorUserId: req.query.actorUserId as string | undefined,
        action: req.query.action as string | undefined,
        targetType: req.query.targetType as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };
      const result = await storage.getAuditLogsFiltered(filters);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const enrichedLogs = result.logs.map(log => ({
        ...log,
        actorName: (() => {
          const u = log.actorUserId ? userMap.get(log.actorUserId) : undefined;
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "System";
        })(),
      }));
      res.json({ logs: enrichedLogs, total: result.total });
    } catch (error) {
      console.error("Error fetching filtered audit logs:", error);
      handleRouteError(res, error, "Failed to fetch audit logs");
    }
  });

  app.get("/api/roles", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      const allRoles = await storage.getAllRoles();
      const { sql: drizzleSql } = await import("drizzle-orm");
      const counts = await db
        .select({ roleId: userRolesTable.roleId, count: drizzleSql<number>`count(*)::int` })
        .from(userRolesTable)
        .groupBy(userRolesTable.roleId);
      const countMap = new Map(counts.map((c) => [c.roleId, Number(c.count)]));
      const rolesWithPermissions = await Promise.all(
        allRoles.map(async (role) => {
          const perms = await storage.getRolePermissions(role.id);
          return { ...role, permissions: perms, userCount: countMap.get(role.id) ?? 0 };
        })
      );
      const filtered = isSuperAdmin
        ? rolesWithPermissions
        : rolesWithPermissions.filter(r => !r.permissions.some((p: any) => p.key === "system.super_admin"));
      res.json(filtered);
    } catch (error) {
      console.error("Error fetching roles:", error);
      handleRouteError(res, error, "Failed to fetch roles");
    }
  });

  app.post("/api/roles", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const { permissionIds, ...roleData } = req.body;
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin && permissionIds && Array.isArray(permissionIds)) {
        const superAdminPerm = await storage.getPermissionByKey("system.super_admin");
        if (superAdminPerm && permissionIds.includes(superAdminPerm.id)) {
          return res.status(403).json({ message: "Cannot assign super admin permission" });
        }
      }
      const parsed = insertRoleSchema.safeParse(roleData);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role data", errors: parsed.error.flatten() });
      }
      const role = await storage.createRole(parsed.data);
      if (permissionIds && Array.isArray(permissionIds)) {
        for (const permId of permissionIds) {
          await storage.addRolePermission(role.id, permId);
        }
      }
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "role",
        targetId: role.id,
        action: "role.created",
        newValue: { name: role.name, permissionCount: permissionIds?.length || 0 },
        ...auditCtx,
      });
      const perms = await storage.getRolePermissions(role.id);
      res.status(201).json({ ...role, permissions: perms });
    } catch (error) {
      console.error("Error creating role:", error);
      handleRouteError(res, error, "Failed to create role");
    }
  });

  app.patch("/api/roles/:id", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin) {
        const existingPerms = await storage.getRolePermissions(String(req.params.id));
        if (existingPerms.some(p => p.key === "system.super_admin")) {
          return res.status(403).json({ message: "Cannot edit a role with super admin privileges" });
        }
      }
      const { permissionIds, ...roleData } = req.body;
      if (!isSuperAdmin && permissionIds && Array.isArray(permissionIds)) {
        const superAdminPerm = await storage.getPermissionByKey("system.super_admin");
        if (superAdminPerm && permissionIds.includes(superAdminPerm.id)) {
          return res.status(403).json({ message: "Cannot assign super admin permission" });
        }
      }
      let role;
      if (Object.keys(roleData).length > 0) {
        role = await storage.updateRole(String(req.params.id), roleData);
      } else {
        role = await storage.getRole(String(req.params.id));
      }
      if (!role) return res.status(404).json({ message: "Role not found" });
      if (permissionIds && Array.isArray(permissionIds)) {
        await storage.setRolePermissions(role.id, permissionIds);
      }
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "role",
        targetId: role.id,
        action: "role.updated",
        newValue: { name: role.name, changes: Object.keys(req.body) },
        ...auditCtx,
      });
      const perms = await storage.getRolePermissions(role.id);
      res.json({ ...role, permissions: perms });
    } catch (error) {
      console.error("Error updating role:", error);
      handleRouteError(res, error, "Failed to update role");
    }
  });

  app.post("/api/roles/:id/duplicate", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const sourceRole = await storage.getRole(String(req.params.id));
      if (!sourceRole) return res.status(404).json({ message: "Role not found" });
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin) {
        const sourcePermsCheck = await storage.getRolePermissions(sourceRole.id);
        if (sourcePermsCheck.some(p => p.key === "system.super_admin")) {
          return res.status(403).json({ message: "Cannot duplicate a role with super admin privileges" });
        }
      }
      const newRole = await storage.createRole({
        name: `${sourceRole.name} (Copy)`,
        description: sourceRole.description,
        isSystem: false,
        companyId: sourceRole.companyId,
      });
      const sourcePerms = await storage.getRolePermissions(sourceRole.id);
      for (const perm of sourcePerms) {
        await storage.addRolePermission(newRole.id, perm.id);
      }
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "role",
        targetId: newRole.id,
        action: "role.duplicated",
        newValue: { name: newRole.name, sourceRoleId: sourceRole.id },
        ...auditCtx,
      });
      const perms = await storage.getRolePermissions(newRole.id);
      res.status(201).json({ ...newRole, permissions: perms });
    } catch (error) {
      console.error("Error duplicating role:", error);
      handleRouteError(res, error, "Failed to duplicate role");
    }
  });

  app.delete("/api/roles/:id", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const role = await storage.getRole(String(req.params.id));
      if (!role) return res.status(404).json({ message: "Role not found" });
      if (role.isSystem) return res.status(400).json({ message: "Cannot delete system roles" });
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin) {
        const rolePerms = await storage.getRolePermissions(role.id);
        if (rolePerms.some(p => p.key === "system.super_admin")) {
          return res.status(403).json({ message: "Cannot delete a role with super admin privileges" });
        }
      }
      const { sql: drizzleSql } = await import("drizzle-orm");
      const [{ count }] = await db
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(userRolesTable)
        .where(eq(userRolesTable.roleId, role.id));
      if (Number(count) > 0) {
        return res.status(400).json({
          message: `Cannot delete a role with ${count} assigned user${Number(count) === 1 ? "" : "s"}. Reassign users first.`,
        });
      }
      await storage.deleteRole(String(req.params.id));
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "role",
        targetId: String(req.params.id),
        action: "role.deleted",
        oldValue: { name: role.name },
        ...auditCtx,
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting role:", error);
      handleRouteError(res, error, "Failed to delete role");
    }
  });

  app.get("/api/permissions", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      const allPerms = await storage.getAllPermissions();
      const filteredPerms = isSuperAdmin ? allPerms : allPerms.filter(p => p.key !== "system.super_admin");
      res.json(filteredPerms);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      handleRouteError(res, error, "Failed to fetch permissions");
    }
  });

  app.get("/api/kiosk-devices", requireAuth, requirePermission("kiosk.manage"), async (_req, res) => {
    try {
      const devices = await storage.getAllKioskDevices();
      // Decorate with a derived liveness status (online / idle / offline / unpaired /
      // inactive) so the admin UI can show a meaningful badge instead of just a date.
      const enriched = devices.map((d) => ({
        ...d,
        derivedStatus: deriveDeviceStatus(d),
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching kiosk devices:", error);
      handleRouteError(res, error, "Failed to fetch kiosk devices");
    }
  });

  // Generate (or regenerate) a short-lived pairing code for a device. The code is
  // 6 digits and lives 10 minutes — long enough for an admin to walk the code to
  // the tablet, short enough that stale codes don't pile up.
  app.post("/api/kiosk-devices/:id/pairing-code", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.getKioskDevice(String(req.params.id));
      if (!device) return res.status(404).json({ message: "Device not found" });
      // Loop a few times to avoid the (very unlikely) collision with another device's
      // current code, since the column is not unique.
      let code = generatePairingCode();
      for (let i = 0; i < 5; i++) {
        const existing = await storage.getKioskByPairingCode(code);
        if (!existing || existing.id === device.id) break;
        code = generatePairingCode();
      }
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const updated = await storage.setKioskPairingCode(device.id, code, expiresAt);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: device.id,
        action: "kiosk_device.pairing_code_issued",
        newValue: { expiresAt },
        ...getAuditContext(req),
      });
      res.json({
        code,
        expiresAt: expiresAt.toISOString(),
        device: { ...updated, derivedStatus: deriveDeviceStatus(updated || device) },
      });
    } catch (error) {
      console.error("Error generating pairing code:", error);
      handleRouteError(res, error, "Failed to generate pairing code");
    }
  });

  app.post("/api/kiosk-devices/:id/unpair", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.getKioskDevice(String(req.params.id));
      if (!device) return res.status(404).json({ message: "Device not found" });
      const updated = await storage.unpairKioskDevice(device.id);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: device.id,
        action: "kiosk_device.unpaired",
        oldValue: { status: device.status, pairedAt: device.pairedAt },
        ...getAuditContext(req),
      });
      res.json({ ...updated, derivedStatus: deriveDeviceStatus(updated || device) });
    } catch (error) {
      console.error("Error unpairing kiosk device:", error);
      handleRouteError(res, error, "Failed to unpair device");
    }
  });

  app.get("/api/kiosk-devices/:id/recent-punches", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.getKioskDevice(String(req.params.id));
      if (!device) return res.status(404).json({ message: "Device not found" });
      const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);
      const [punches, totals] = await Promise.all([
        storage.getRecentPunchesByKiosk(device.id, limit),
        storage.getKioskPunchTotalsToday(device.id),
      ]);
      res.json({
        deviceId: device.id,
        punches: punches.map((p) => ({
          id: p.id,
          employeeId: p.employeeId,
          employeeName: p.employeeName,
          clockIn: p.clockIn,
          clockOut: p.clockOut,
          type: p.clockOut ? "clock_out" : "clock_in",
          timestamp: p.clockOut || p.clockIn,
          workDate: p.workDate,
        })),
        totals,
      });
    } catch (error) {
      console.error("Error fetching kiosk recent punches:", error);
      handleRouteError(res, error, "Failed to fetch recent punches");
    }
  });

  app.post("/api/kiosk-devices", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const parsed = insertKioskDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid device data", errors: parsed.error.flatten() });
      }
      const device = await storage.createKioskDevice(parsed.data);
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: device.id,
        action: "kiosk_device.created",
        newValue: { name: device.name },
        ...auditCtx,
      });
      res.status(201).json(device);
    } catch (error) {
      console.error("Error creating kiosk device:", error);
      handleRouteError(res, error, "Failed to create kiosk device");
    }
  });

  app.patch("/api/kiosk-devices/:id", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.updateKioskDevice(String(req.params.id), req.body);
      if (!device) return res.status(404).json({ message: "Device not found" });
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: device.id,
        action: "kiosk_device.updated",
        newValue: { name: device.name, changes: Object.keys(req.body) },
        ...auditCtx,
      });
      res.json(device);
    } catch (error) {
      console.error("Error updating kiosk device:", error);
      handleRouteError(res, error, "Failed to update kiosk device");
    }
  });

  app.delete("/api/kiosk-devices/:id", requireAuth, requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.getKioskDevice(String(req.params.id));
      if (!device) return res.status(404).json({ message: "Device not found" });
      await storage.deleteKioskDevice(String(req.params.id));
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: String(req.params.id),
        action: "kiosk_device.deleted",
        oldValue: { name: device.name },
        ...auditCtx,
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting kiosk device:", error);
      handleRouteError(res, error, "Failed to delete kiosk device");
    }
  });

  // ========= Auto Role Assignment Rules =========

  const roleRuleSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    conditions: z.any(),
    targetRole: z.string().min(1),
    priority: z.number().int().min(1).max(10000).default(100),
    isActive: z.boolean().default(true),
  });

  app.get("/api/role-rules", requireAuth, requirePermission("roles.manage"), async (_req, res) => {
    const rules = await storage.getAllRoleAssignmentRules();
    res.json(rules);
  });

  app.get("/api/role-rules/:id", requireAuth, requirePermission("roles.manage"), async (req, res) => {
    const rule = await storage.getRoleAssignmentRule(String(req.params.id));
    if (!rule) return res.status(404).json({ message: "Rule not found" });
    res.json(rule);
  });

  app.post("/api/role-rules", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    const parsed = roleRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rule", errors: parsed.error.flatten() });
    }
    if (!isAllowedRole(parsed.data.targetRole)) {
      return res.status(400).json({ message: "targetRole must be employee, manager, or admin" });
    }
    const v = validateConditions(parsed.data.conditions);
    if (!v.ok) return res.status(400).json({ message: v.error });
    const created = await storage.createRoleAssignmentRule({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      conditions: parsed.data.conditions,
      targetRole: parsed.data.targetRole,
      priority: parsed.data.priority,
      isActive: parsed.data.isActive,
      createdBy: req.authUser.id,
    });
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: created.id,
      action: "role_assignment_rule.create",
      newValue: created,
      ...getAuditContext(req),
    });
    res.status(201).json(created);
  });

  app.patch("/api/role-rules/:id", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    const existing = await storage.getRoleAssignmentRule(String(req.params.id));
    if (!existing) return res.status(404).json({ message: "Rule not found" });
    const parsed = roleRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rule", errors: parsed.error.flatten() });
    }
    if (parsed.data.targetRole !== undefined && !isAllowedRole(parsed.data.targetRole)) {
      return res.status(400).json({ message: "targetRole must be employee, manager, or admin" });
    }
    if (parsed.data.conditions !== undefined) {
      const v = validateConditions(parsed.data.conditions);
      if (!v.ok) return res.status(400).json({ message: v.error });
    }
    const updated = await storage.updateRoleAssignmentRule(String(req.params.id), parsed.data);
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: String(req.params.id),
      action: "role_assignment_rule.update",
      oldValue: existing,
      newValue: updated,
      ...getAuditContext(req),
    });
    res.json(updated);
  });

  app.delete("/api/role-rules/:id", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    const existing = await storage.getRoleAssignmentRule(String(req.params.id));
    if (!existing) return res.status(404).json({ message: "Rule not found" });
    await storage.deleteRoleAssignmentRule(String(req.params.id));
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: String(req.params.id),
      action: "role_assignment_rule.delete",
      oldValue: existing,
      ...getAuditContext(req),
    });
    res.status(204).send();
  });

  const reevaluateAllHandler = async (req: any, res: any) => {
    const allUsers = await storage.getAllUsers();
    const job = await enqueue("re-evaluate-role-assignments", {
      actorUserId: req.authUser.id,
      reason: "manual re-evaluation",
    });
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: job.id,
      action: "role_assignment_rules.reevaluate_all",
      newValue: { jobId: job.id, employeeCount: allUsers.length, reason: "manual re-evaluation" },
      ...getAuditContext(req),
    });
    return res.status(202).json({ jobId: job.id, employeeCount: allUsers.length });
  };
  app.post("/api/role-rules/reevaluate-all", requireAuth, requirePermission("roles.manage"), reevaluateAllHandler);
  app.post("/api/role-rules/re-evaluate", requireAuth, requirePermission("roles.manage"), reevaluateAllHandler);

  const roleRuleTestSchema = z.object({
    conditions: z.any(),
    targetRole: z.string().min(1).optional(),
    userIds: z.array(z.string().min(1)).max(500).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  });

  app.post("/api/role-rules/test", requireAuth, requirePermission("roles.manage"), async (req: any, res) => {
    const parsed = roleRuleTestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid test request", errors: parsed.error.flatten() });
    }
    if (parsed.data.targetRole !== undefined && !isAllowedRole(parsed.data.targetRole)) {
      return res.status(400).json({ message: "targetRole must be employee, manager, or admin" });
    }
    const v = validateConditions(parsed.data.conditions);
    if (!v.ok) return res.status(400).json({ message: v.error });

    const allUsers = parsed.data.userIds && parsed.data.userIds.length > 0
      ? (await Promise.all(parsed.data.userIds.map(id => storage.getUser(id)))).filter((u): u is NonNullable<typeof u> => !!u)
      : await storage.getAllUsers();

    const limit = parsed.data.limit ?? 50;
    const matchedUsers: Array<{ userId: string; name: string; email: string; currentRole: string; wouldBecomeRole?: string }> = [];
    let matchedCount = 0;

    const { evaluateRoleForUser } = await import("./services/roleAssignment");
    const syntheticRule = {
      id: "test-rule",
      name: "test",
      description: null,
      conditions: parsed.data.conditions,
      targetRole: parsed.data.targetRole ?? "employee",
      priority: 0,
      isActive: true,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    for (const u of allUsers) {
      const profile = await storage.getEmploymentProfile(u.id);
      const match = evaluateRoleForUser(u, profile, [syntheticRule]);
      if (match) {
        matchedCount++;
        if (matchedUsers.length < limit) {
          matchedUsers.push({
            userId: u.id,
            name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
            email: u.email ?? "",
            currentRole: u.role,
            wouldBecomeRole: parsed.data.targetRole,
          });
        }
      }
    }

    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: "test",
      action: "role_assignment_rule.test",
      newValue: {
        conditions: parsed.data.conditions,
        targetRole: parsed.data.targetRole,
        scopeUserIds: parsed.data.userIds ?? null,
        evaluated: allUsers.length,
        matched: matchedCount,
      },
      ...getAuditContext(req),
    });

    res.json({
      evaluated: allUsers.length,
      matched: matchedCount,
      sample: matchedUsers,
      limit,
    });
  });

  // ========= Schedule Templates =========

  const templateDayInputSchema = z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    isWorkDay: z.boolean(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  });

  const scheduleTemplateSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    companyId: z.string().nullable().optional(),
    isActive: z.boolean().default(true),
    days: z.array(templateDayInputSchema).max(7).optional(),
  });

  app.get("/api/schedule-templates", requireAuth, requirePermission("schedules.view"), async (req, res) => {
    const companyId = req.query.companyId as string | undefined;
    const templates = companyId
      ? await storage.getScheduleTemplatesByCompany(companyId)
      : await storage.getAllScheduleTemplates();
    res.json(templates);
  });

  app.get("/api/schedule-templates/:id", requireAuth, requirePermission("schedules.view"), async (req, res) => {
    const template = await storage.getScheduleTemplate(String(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    const days = await storage.getScheduleTemplateDays(String(req.params.id));
    res.json({ ...template, days });
  });

  app.post("/api/schedule-templates", requireAuth, requirePermission("schedules.manage"), async (req: any, res) => {
    const parsed = scheduleTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    }
    if (parsed.data.days) {
      const v = validateTemplateDays(parsed.data.days);
      if (!v.ok) return res.status(400).json({ message: v.error });
    }
    const created = await storage.createScheduleTemplate({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      companyId: parsed.data.companyId ?? null,
      isActive: parsed.data.isActive,
      createdBy: req.authUser.id,
    });
    let days: any[] = [];
    if (parsed.data.days) {
      days = await storage.replaceScheduleTemplateDays(created.id, parsed.data.days);
    }
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "schedule_template",
      targetId: created.id,
      action: "schedule_template.create",
      newValue: { ...created, days },
      ...getAuditContext(req),
    });
    res.status(201).json({ ...created, days });
  });

  app.patch("/api/schedule-templates/:id", requireAuth, requirePermission("schedules.manage"), async (req: any, res) => {
    const existing = await storage.getScheduleTemplate(String(req.params.id));
    if (!existing) return res.status(404).json({ message: "Template not found" });
    const parsed = scheduleTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    }
    if (parsed.data.days) {
      const v = validateTemplateDays(parsed.data.days);
      if (!v.ok) return res.status(400).json({ message: v.error });
    }
    const { days, ...updateFields } = parsed.data;
    const updated = await storage.updateScheduleTemplate(String(req.params.id), updateFields);
    let updatedDays: any[] = await storage.getScheduleTemplateDays(String(req.params.id));
    if (days) {
      updatedDays = await storage.replaceScheduleTemplateDays(String(req.params.id), days);
    }
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "schedule_template",
      targetId: String(req.params.id),
      action: "schedule_template.update",
      oldValue: existing,
      newValue: { ...updated, days: updatedDays },
      ...getAuditContext(req),
    });
    res.json({ ...updated, days: updatedDays });
  });

  app.delete("/api/schedule-templates/:id", requireAuth, requirePermission("schedules.manage"), async (req: any, res) => {
    const existing = await storage.getScheduleTemplate(String(req.params.id));
    if (!existing) return res.status(404).json({ message: "Template not found" });
    await storage.deleteScheduleTemplate(String(req.params.id));
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "schedule_template",
      targetId: String(req.params.id),
      action: "schedule_template.delete",
      oldValue: existing,
      ...getAuditContext(req),
    });
    res.status(204).send();
  });

  const applyTemplateSchema = z.object({
    employeeIds: z.array(z.string().min(1)).min(1).max(2000),
    mode: z.enum(["replace", "merge"]).default("replace"),
  });

  app.post("/api/schedule-templates/:id/apply", requireAuth, requirePermission("schedules.manage"), async (req: any, res) => {
    const template = await storage.getScheduleTemplate(String(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (!template.isActive) {
      return res.status(400).json({ message: "Template is inactive and can no longer be applied" });
    }
    const parsed = applyTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequestFromZod(res, parsed, "Invalid apply-template request");
    }
    const employeeIds = Array.from(new Set(parsed.data.employeeIds));
    if (employeeIds.length > 50) {
      const job = await enqueue("apply-schedule-template", {
        templateId: String(req.params.id),
        employeeIds,
        mode: parsed.data.mode,
        actorUserId: req.authUser.id,
      });
      return res.json({ async: true, jobId: job.id, employeeCount: employeeIds.length });
    }
    const result = await applyScheduleTemplate({
      templateId: String(req.params.id),
      employeeIds,
      mode: parsed.data.mode,
      actorUserId: req.authUser.id,
    });
    res.json({ async: false, ...result });
  });

  app.get("/api/workflows", requireAuth, requirePermission("workflows.manage"), async (_req, res) => {
    try {
      const allWorkflows = await storage.getAllWorkflows();
      res.json(allWorkflows);
    } catch (error) {
      console.error("Error fetching workflows:", error);
      handleRouteError(res, error, "Failed to fetch workflows");
    }
  });

  app.get("/api/workflows/:id", requireAuth, requirePermission("workflows.manage"), async (req, res) => {
    try {
      const workflow = await storage.getWorkflow(String(req.params.id));
      if (!workflow) return res.status(404).json({ message: "Workflow not found" });
      res.json(workflow);
    } catch (error) {
      console.error("Error fetching workflow:", error);
      handleRouteError(res, error, "Failed to fetch workflow");
    }
  });

  app.post("/api/workflows", requireAuth, requirePermission("workflows.manage"), async (req: any, res) => {
    try {
      const { name, triggerType, policyTypeId, status, nodeGraph } = req.body;
      if (!name || !triggerType || !nodeGraph) {
        return res.status(400).json({ message: "Name, triggerType, and nodeGraph are required" });
      }
      const workflow = await storage.createWorkflow({
        name,
        triggerType,
        policyTypeId: policyTypeId || null,
        status: status || "draft",
        nodeGraph,
      });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "workflow.created",
        targetId: workflow.id,
        targetType: "workflow",
        newValue: { name: workflow.name, triggerType: workflow.triggerType },
        ...getAuditContext(req),
      });
      res.status(201).json(workflow);
    } catch (error) {
      console.error("Error creating workflow:", error);
      handleRouteError(res, error, "Failed to create workflow");
    }
  });

  app.patch("/api/workflows/:id", requireAuth, requirePermission("workflows.manage"), async (req: any, res) => {
    try {
      const existing = await storage.getWorkflow(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Workflow not found" });
      const { name, triggerType, policyTypeId, status, nodeGraph } = req.body;
      const updated = await storage.updateWorkflow(String(req.params.id), {
        ...(name !== undefined && { name }),
        ...(triggerType !== undefined && { triggerType }),
        ...(policyTypeId !== undefined && { policyTypeId }),
        ...(status !== undefined && { status }),
        ...(nodeGraph !== undefined && { nodeGraph }),
      });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "workflow.updated",
        targetId: String(req.params.id),
        targetType: "workflow",
        oldValue: { name: existing.name, status: existing.status },
        newValue: { name: updated?.name, status: updated?.status },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating workflow:", error);
      handleRouteError(res, error, "Failed to update workflow");
    }
  });

  app.delete("/api/workflows/:id", requireAuth, requirePermission("workflows.manage"), async (req: any, res) => {
    try {
      const existing = await storage.getWorkflow(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Workflow not found" });
      await storage.deleteWorkflow(String(req.params.id));
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "workflow.deleted",
        targetId: String(req.params.id),
        targetType: "workflow",
        oldValue: { name: existing.name },
        ...getAuditContext(req),
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting workflow:", error);
      handleRouteError(res, error, "Failed to delete workflow");
    }
  });

  // ===== Performance review cycles =====
  app.get("/api/review-cycles", requireAuth, requirePermission("reviews.manage"), async (req: any, res) => {
    try {
      const isActive =
        typeof req.query.isActive === "string"
          ? req.query.isActive === "true"
          : undefined;
      const requestedCompanyId =
        typeof req.query.companyId === "string" ? req.query.companyId : undefined;

      let companyIdFilter: string | null | undefined;
      if (requestedCompanyId === "null") {
        companyIdFilter = null;
      } else if (requestedCompanyId) {
        companyIdFilter = requestedCompanyId;
      } else {
        companyIdFilter = undefined;
      }

      const cycles = await storage.getReviewCycles({
        isActive,
        companyId: companyIdFilter,
      });
      res.json(cycles);
    } catch (err) {
      console.error("[GET /api/review-cycles]", err);
      handleRouteError(res, err, "Failed to fetch review cycles");
    }
  });

  app.post("/api/review-cycles", requireAuth, requirePermission("reviews.manage"), async (req: any, res) => {
    try {
      const parsed = insertPerformanceReviewCycleSchema.parse(req.body);
      const created = await storage.createReviewCycle(parsed);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_cycle.created",
        targetType: "review_cycle",
        targetId: created.id,
        newValue: { name: created.name, cadence: created.cadence, anchor: created.anchor },
        ...getAuditContext(req),
      });
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid review cycle", issues: err.issues });
      console.error("[POST /api/review-cycles]", err);
      handleRouteError(res, err, "Failed to create review cycle");
    }
  });

  app.patch("/api/review-cycles/:id", requireAuth, requirePermission("reviews.manage"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewCycle(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Review cycle not found" });
      const parsed = insertPerformanceReviewCycleSchema.partial().parse(req.body);
      const updated = await storage.updateReviewCycle(String(req.params.id), parsed);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_cycle.updated",
        targetType: "review_cycle",
        targetId: String(req.params.id),
        oldValue: { name: existing.name, isActive: existing.isActive },
        newValue: { name: updated?.name, isActive: updated?.isActive },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid review cycle", issues: err.issues });
      console.error("[PATCH /api/review-cycles/:id]", err);
      handleRouteError(res, err, "Failed to update review cycle");
    }
  });

  app.delete("/api/review-cycles/:id", requireAuth, requirePermission("reviews.manage"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewCycle(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Review cycle not found" });
      const updated = await storage.updateReviewCycle(String(req.params.id), { isActive: false });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_cycle.deactivated",
        targetType: "review_cycle",
        targetId: String(req.params.id),
        oldValue: { isActive: existing.isActive },
        newValue: { isActive: false },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (err) {
      console.error("[DELETE /api/review-cycles/:id]", err);
      handleRouteError(res, err, "Failed to deactivate review cycle");
    }
  });

  // ===== Performance review reminders =====
  app.get("/api/review-reminders", requireAuth, async (req: any, res) => {
    try {
      const employeeIdParam = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const cycleId = typeof req.query.cycleId === "string" ? req.query.cycleId : undefined;
      const authUser = req.authUser as User;
      const isAdmin = authUser.role === "admin";
      const isManager = authUser.role === "manager";

      if (isAdmin) {
        const reminders = await storage.listReviewReminders({
          employeeId: employeeIdParam,
          status,
          cycleId,
        });
        return res.json(reminders);
      }

      if (isManager) {
        const teamIds = await getTeamUserIds(authUser);
        teamIds.add(authUser.id);
        if (employeeIdParam) {
          if (!teamIds.has(employeeIdParam)) {
            return res.status(403).json({ message: "Forbidden" });
          }
          const reminders = await storage.listReviewReminders({
            employeeId: employeeIdParam,
            status,
            cycleId,
          });
          return res.json(reminders);
        }
        const all = await storage.listReviewReminders({ status, cycleId });
        return res.json(all.filter((r) => teamIds.has(r.employeeId)));
      }

      // Employees can only see their own reminders
      const reminders = await storage.listReviewReminders({
        employeeId: authUser.id,
        status,
        cycleId,
      });
      res.json(reminders);
    } catch (err) {
      console.error("[GET /api/review-reminders]", err);
      handleRouteError(res, err, "Failed to fetch review reminders");
    }
  });

  app.patch("/api/review-reminders/:id", requireAuth, requirePermission("reviews.update_reminders"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewReminder(String(req.params.id));
      if (!existing) return res.status(404).json({ message: "Reminder not found" });
      const authUser = req.authUser as User;
      if (authUser.role === "manager") {
        const teamIds = await getTeamUserIds(authUser);
        if (!teamIds.has(existing.employeeId)) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      const bodySchema = z.object({
        status: z.enum(["completed", "skipped"]),
        notes: z.string().optional(),
      });
      const parsed = bodySchema.parse(req.body);
      const updated = await storage.updateReviewReminder(String(req.params.id), {
        status: parsed.status,
        completedBy: req.authUser.id,
        notes: parsed.notes,
      });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_reminder.updated",
        targetType: "review_reminder",
        targetId: String(req.params.id),
        oldValue: { status: existing.status },
        newValue: { status: parsed.status, notes: parsed.notes ?? null },
        ...getAuditContext(req),
      });
      if (parsed.status === "completed" || parsed.status === "skipped") {
        await storage.resolveReviewDueAlertsFor(String(req.params.id), req.authUser.id);
      }
      res.json(updated);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid update", issues: err.issues });
      console.error("[PATCH /api/review-reminders/:id]", err);
      handleRouteError(res, err, "Failed to update reminder");
    }
  });

  // ===== PTO anniversary adjustments (read-only) =====
  app.get("/api/users/:id/pto-anniversary-adjustments", requireAuth, async (req: any, res) => {
    try {
      const targetId = String(req.params.id);
      const isSelf = req.authUser.id === targetId;
      const isAdmin = req.authUser.role === "admin";
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const rows = await storage.listPtoAnniversaryAdjustments(targetId);
      const policyIds = Array.from(
        new Set(rows.map((r) => r.ptoPolicyId).filter((v): v is string => Boolean(v))),
      );
      const policyNameById = new Map<string, string>();
      for (const pid of policyIds) {
        const policy = await storage.getPtoPolicy(pid);
        if (policy) policyNameById.set(pid, policy.name);
      }
      const enriched = rows.map((row) => ({
        ...row,
        ptoPolicyName: row.ptoPolicyId ? policyNameById.get(row.ptoPolicyId) ?? null : null,
      }));
      res.json(enriched);
    } catch (err) {
      console.error("[GET /api/users/:id/pto-anniversary-adjustments]", err);
      handleRouteError(res, err, "Failed to fetch anniversary adjustments");
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const wsClients = new Set<WebSocket>();

  wss.on("connection", (ws, req) => {
    const cookies = req.headers.cookie || "";
    const hasSession = cookies.includes("connect.sid=");
    const authHeader = req.headers.authorization || "";
    const hasToken = authHeader.startsWith("Bearer ");
    if (!hasSession && !hasToken) {
      ws.close(4001, "Unauthorized");
      return;
    }
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
    ws.on("error", () => wsClients.delete(ws));
  });

  function broadcastAttendanceUpdate(data: { type: string; employeeId: string; status: string }) {
    const message = JSON.stringify({ event: "attendance_update", data });
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  (globalThis as any).__broadcastAttendanceUpdate = broadcastAttendanceUpdate;

  app.post("/internal/jobs/run", async (req, res) => {
    const provided = req.headers["x-cron-secret"];
    if (!config.cronSecret || provided !== config.cronSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { ensureRecurringEnqueued } = await import("./services/jobs");
      await ensureRecurringEnqueued();
      const result = await drainPending(config.jobsBatchSize);
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("/internal/jobs/run error:", err);
      const mapped = mapRouteError(err, "Failed to drain pending jobs");
      return res.status(mapped.status).json({ ok: false, message: mapped.message });
    }
  });

  app.post("/internal/jobs/enqueue", async (req, res) => {
    const provided = req.headers["x-cron-secret"];
    if (!config.cronSecret || provided !== config.cronSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const ALLOWED_JOB_TYPES = [
      "auto-clock-out",
      "rebuild-report",
      "apply-pto-anniversary-adjustments",
      "evaluate-performance-reviews",
      "re-evaluate-role-assignments",
      "apply-schedule-template",
      "evaluate-missing-documents",
      "evaluate-expiring-certifications",
    ] as const;
    type AllowedJobType = typeof ALLOWED_JOB_TYPES[number];
    const rawType = req.body?.type ?? "auto-clock-out";
    if (typeof rawType !== "string" || !ALLOWED_JOB_TYPES.includes(rawType as AllowedJobType)) {
      return res.status(400).json({
        message: "Invalid job type",
        allowed: ALLOWED_JOB_TYPES,
      });
    }
    const created = await enqueue(rawType as AllowedJobType, req.body?.payload);
    return res.json({ ok: true, job: created });
  });

  // ===================== Background Job Monitoring =====================

  // Per-job-type health for the admin monitoring view: last run / last success /
  // last failure / retry count / last error, plus live pending/running/failed
  // counts and a staleness flag.
  app.get(
    "/api/admin/jobs/health",
    requireAuth,
    requireRole("admin"),
    requirePermission("system.jobs.view"),
    async (_req, res) => {
      try {
        const { getJobHealth, MAX_ATTEMPTS, VISIBILITY_TIMEOUT_MS } = await import("./services/jobs");
        const jobsHealth = await getJobHealth();
        return res.json({
          jobs: jobsHealth,
          config: {
            maxAttempts: MAX_ATTEMPTS,
            visibilityTimeoutMinutes: Math.round(VISIBILITY_TIMEOUT_MS / 60_000),
          },
        });
      } catch (err: any) {
        const mapped = mapRouteError(err, "Failed to load job health");
        return res.status(mapped.status).json({ message: mapped.message });
      }
    },
  );

  // Admin-triggered drain: enqueue any due recurring jobs and process the queue
  // now. Lets an admin manually kick the runner and reclaim stuck jobs from the
  // monitoring view.
  app.post(
    "/api/admin/jobs/run",
    requireAuth,
    requireRole("admin"),
    requirePermission("system.jobs.view"),
    async (_req, res) => {
      try {
        const { ensureRecurringEnqueued } = await import("./services/jobs");
        await ensureRecurringEnqueued();
        const result = await drainPending(config.jobsBatchSize);
        return res.json({ ok: true, ...result });
      } catch (err: any) {
        console.error("/api/admin/jobs/run error:", err);
        const mapped = mapRouteError(err, "Failed to run jobs");
        return res.status(mapped.status).json({ ok: false, message: mapped.message });
      }
    },
  );

  // ===================== Lifecycle Wizards: Onboarding =====================

  app.get("/api/onboarding-templates", requireAuth, requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    const requestedCompanyId = (req.query.companyId as string | undefined) ?? actor.companyId ?? null;
    if (!isSuperAdmin(req) && requestedCompanyId !== null && requestedCompanyId !== (actor.companyId ?? null)) {
      return res.status(403).json({ message: "Forbidden: cannot list templates for another company" });
    }
    const templates = await storage.getOnboardingTemplates({ companyId: requestedCompanyId });
    res.json(templates);
  });

  app.get("/api/onboarding-templates/:id", requireAuth, requirePermission("users.view"), async (req, res) => {
    const t = await storage.getOnboardingTemplate(String(req.params.id));
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const tasks = await storage.getOnboardingTemplateTasks(t.id);
    res.json({ ...t, tasks });
  });

  app.post("/api/onboarding-templates", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateSchema.safeParse({
      ...req.body,
      createdBy: (req as any).authUser?.id ?? null,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const actor = (req as any).authUser as User;
    // Only super-admin may create global (companyId=null) or cross-company templates.
    // Tenant admins are forced to their own company scope regardless of input.
    if (!isSuperAdmin(req)) {
      const cid = parsed.data.companyId ?? null;
      if (cid !== null && cid !== (actor.companyId ?? null)) {
        return res.status(403).json({ message: "Forbidden: cannot create template for another company" });
      }
      if (cid === null) {
        if (!actor.companyId) {
          return res.status(403).json({ message: "Forbidden: cannot create global template" });
        }
        parsed.data.companyId = actor.companyId;
      }
    }
    const created = await storage.createOnboardingTemplate(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template.create", actorUserId: (req as any).authUser.id, targetType: "onboarding_template", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/onboarding-templates/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const before = await storage.getOnboardingTemplate(String(req.params.id));
    if (!before) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, before, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!isSuperAdmin(req) && "companyId" in parsed.data) {
      const cid = parsed.data.companyId ?? null;
      // Tenant admins cannot reassign to another company AND cannot promote
      // a template to global (companyId=null).
      if (cid === null || cid !== (actor.companyId ?? null)) {
        return res.status(403).json({ message: "Forbidden: cannot reassign template scope" });
      }
    }
    const updated = await storage.updateOnboardingTemplate(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Template not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template.update", actorUserId: (req as any).authUser.id, targetType: "onboarding_template", targetId: updated.id, oldValue: before, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  const ALLOWED_ONBOARDING_DOCUMENT_TYPES = new Set(["w9", "i9", "direct_deposit", "emergency_contact", "handbook_ack"]);
  function validateOnboardingDocumentType(documentType: unknown): { ok: boolean; message?: string } {
    if (documentType === undefined || documentType === null || documentType === "") return { ok: true };
    if (typeof documentType !== "string") return { ok: false, message: "documentType must be a string" };
    if (!ALLOWED_ONBOARDING_DOCUMENT_TYPES.has(documentType)) {
      return { ok: false, message: `documentType must be one of: ${Array.from(ALLOWED_ONBOARDING_DOCUMENT_TYPES).join(", ")}` };
    }
    return { ok: true };
  }

  app.post("/api/onboarding-templates/:templateId/tasks", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOnboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const parsed = insertOnboardingTemplateTaskSchema.safeParse({ ...req.body, templateId: String(req.params.templateId) });
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const docCheck = validateOnboardingDocumentType(parsed.data.documentType);
    if (!docCheck.ok) return res.status(400).json({ message: docCheck.message });
    const created = await storage.createOnboardingTemplateTask(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.create", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/onboarding-template-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateTaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const existingTask = await storage.getOnboardingTemplateTask(String(req.params.id));
    if (!existingTask) return res.status(404).json({ message: "Task not found" });
    const parent = await storage.getOnboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    // Re-parenting a template task across templates is not supported via this
    // endpoint. Disallow `templateId` mutation to prevent cross-scope IDOR.
    if ("templateId" in parsed.data && parsed.data.templateId !== existingTask.templateId) {
      return res.status(400).json({ message: "Cannot change templateId of a template task" });
    }
    delete (parsed.data as Record<string, unknown>).templateId;
    if ("documentType" in parsed.data) {
      const docCheck = validateOnboardingDocumentType(parsed.data.documentType);
      if (!docCheck.ok) return res.status(400).json({ message: docCheck.message });
    }
    const updated = await storage.updateOnboardingTemplateTask(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.update", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: updated.id, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.delete("/api/onboarding-template-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const existingTask = await storage.getOnboardingTemplateTask(String(req.params.id));
    if (!existingTask) return res.status(204).end();
    const parent = await storage.getOnboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.deleteOnboardingTemplateTask(String(req.params.id));
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.delete", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: String(req.params.id), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });

  app.get("/api/onboarding-checklists", requireAuth, async (req, res) => {
    const actor = (req as any).authUser as User;
    const params: { status?: string; employeeIds?: string[] } = {};
    if (typeof req.query.status === "string") params.status = req.query.status;

    if (actor.role === "admin") {
      // unrestricted (super admins see all)
    } else if (actor.role === "manager") {
      const team = await getTeamUserIds(actor);
      params.employeeIds = Array.from(team);
    } else {
      params.employeeIds = [actor.id];
    }
    const checklists = await storage.listOnboardingChecklists(params);
    res.json(checklists);
  });

  app.get("/api/onboarding-checklists/my", requireAuth, async (req, res) => {
    const actor = (req as any).authUser as User;
    const cl = await storage.getOnboardingChecklistByEmployee(actor.id);
    if (!cl) return res.json(null);
    const tasks = await storage.getOnboardingTasks(cl.id);
    // Self-view: only return new_hire-owned and system-owned tasks (data minimization).
    const visibleTasks = tasks.filter(t => t.ownerRole === "new_hire" || t.ownerRole === "system");
    const progress = await storage.computeOnboardingProgress(cl.id);
    res.json({ ...cl, tasks: visibleTasks, progress });
  });

  app.get("/api/onboarding-checklists/by-employee/:employeeId", requireAuth, async (req, res) => {
    const actor = (req as any).authUser as User;
    let isManagerOnTeam = false;
    if (actor.role !== "admin" && actor.id !== String(req.params.employeeId)) {
      if (actor.role === "manager") {
        const team = await getTeamUserIds(actor);
        if (!team.has(String(req.params.employeeId))) return res.status(403).json({ message: "Forbidden" });
        isManagerOnTeam = true;
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }
    }
    const cl = await storage.getOnboardingChecklistByEmployee(String(req.params.employeeId));
    if (!cl) return res.json(null);
    const tasks = await storage.getOnboardingTasks(cl.id);
    // Self-only viewers (employee, not admin/manager-on-team) see only their own role's tasks.
    const isSelfOnly = actor.id === String(req.params.employeeId) && actor.role !== "admin" && !isManagerOnTeam;
    const visibleTasks = isSelfOnly
      ? tasks.filter(t => t.ownerRole === "new_hire" || t.ownerRole === "system")
      : tasks;
    const progress = await storage.computeOnboardingProgress(cl.id);
    res.json({ ...cl, tasks: visibleTasks, progress });
  });

  app.get("/api/onboarding-checklists/:id", requireAuth, async (req, res) => {
    const cl = await storage.getOnboardingChecklist(String(req.params.id));
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    const actor = (req as any).authUser as User;
    let isManagerOnTeam = false;
    if (actor.role !== "admin" && actor.id !== cl.employeeId) {
      if (actor.role === "manager") {
        const team = await getTeamUserIds(actor);
        if (!team.has(cl.employeeId)) return res.status(403).json({ message: "Forbidden" });
        isManagerOnTeam = true;
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }
    }
    const tasks = await storage.getOnboardingTasks(cl.id);
    const isSelfOnly = actor.id === cl.employeeId && actor.role !== "admin" && !isManagerOnTeam;
    const visibleTasks = isSelfOnly
      ? tasks.filter(t => t.ownerRole === "new_hire" || t.ownerRole === "system")
      : tasks;
    const progress = await storage.computeOnboardingProgress(cl.id);
    res.json({ ...cl, tasks: visibleTasks, progress });
  });

  const startOnboardingSchema = z.object({
    templateId: z.string().optional().nullable(),
    hireDate: z.string().optional().nullable(),
  });
  app.post("/api/employees/:id/start-onboarding", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = startOnboardingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequestFromZod(res, parsed, "Invalid onboarding request");
    const employee = await storage.getUser(String(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const ctx = getAuditContext(req);
    const cl = await materializeOnboardingChecklist(employee, {
      templateId: parsed.data.templateId ?? null,
      hireDate: parsed.data.hireDate ?? null,
      startedBy: (req as any).authUser.id,
      context: { ip: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
    });
    if (!cl) return res.status(409).json({ message: "Could not start onboarding (no template available)" });
    res.status(201).json(cl);
  });

  const updateOnboardingTaskSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
    notes: z.string().nullable().optional(),
    skippedReason: z.string().nullable().optional(),
  });
  app.patch("/api/onboarding-tasks/:id", requireAuth, async (req, res) => {
    const parsed = updateOnboardingTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid task update", errors: parsed.error.flatten() });
    const task = await storage.getOnboardingTask(String(req.params.id));
    if (!task) return res.status(404).json({ message: "Task not found" });
    const checklist = await storage.getOnboardingChecklist(task.checklistId);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });
    const actor = (req as any).authUser as User;
    const isOwner = actor.id === checklist.employeeId;
    const isAdmin = actor.role === "admin";
    const isManager = actor.role === "manager";
    let isManagerOnTeam = false;
    if (isManager) {
      const team = await getTeamUserIds(actor);
      isManagerOnTeam = team.has(checklist.employeeId);
    }
    if (!isOwner && !isAdmin && !isManagerOnTeam) {
      return res.status(403).json({ message: "Forbidden" });
    }
    // Owner-role alignment: only the role that owns the task can mutate it.
    // Employees (new hires) may only mutate tasks with ownerRole='new_hire'.
    // Managers may only mutate ownerRole 'manager' or 'it' for their team.
    // Admins may mutate any task.
    if (!isAdmin) {
      if (isOwner && !isManagerOnTeam) {
        if (task.ownerRole !== "new_hire") return res.status(403).json({ message: "Only the task owner role can update this task" });
        // New hires may skip only optional tasks (with reason). Required tasks must be completed.
        if (parsed.data.status === "skipped" && task.isRequired) {
          return res.status(403).json({ message: "Required tasks cannot be skipped by the new hire" });
        }
      } else if (isManagerOnTeam) {
        if (task.ownerRole !== "manager" && task.ownerRole !== "it") {
          return res.status(403).json({ message: "Manager role cannot update this task type" });
        }
      }
    }
    if (parsed.data.status === "skipped" && !parsed.data.skippedReason) {
      return res.status(400).json({ message: "skippedReason is required when skipping" });
    }
    const completing = parsed.data.status === "completed";
    const updated = await storage.updateOnboardingTask(String(req.params.id), {
      status: parsed.data.status,
      notes: "notes" in parsed.data ? parsed.data.notes : undefined,
      skippedReason: "skippedReason" in parsed.data ? parsed.data.skippedReason : undefined,
      completedAt: completing ? new Date() : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
      completedBy: completing ? actor.id : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
    });
    const completed = await storage.completeOnboardingChecklistIfFinished(task.checklistId);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_task.update", actorUserId: actor.id, targetType: "onboarding_task", targetId: String(req.params.id), oldValue: task, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    if (completed) {
      await writeAuditLog({ action: "onboarding.complete", actorUserId: actor.id, targetType: "onboarding_checklist", targetId: task.checklistId, newValue: { trigger: "task_update" }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    }
    res.json(updated);
  });

  app.post("/api/onboarding-checklists/:id/cancel", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Cancelled by admin";
    const updated = await storage.cancelOnboardingChecklist(String(req.params.id), reason, (req as any).authUser.id);
    if (!updated) return res.status(404).json({ message: "Checklist not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding.cancel", actorUserId: (req as any).authUser.id, targetType: "onboarding_checklist", targetId: String(req.params.id), newValue: { reason }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  // ===== Flexible lifecycle: sections / scopes / suggest / duplicate / delete / propagate =====

  async function loadFlexibleOnboardingTemplate(id: string) {
    const t = await storage.getOnboardingTemplate(id);
    if (!t) return null;
    const [sections, tasks, scopes] = await Promise.all([
      storage.getOnboardingTemplateSections(id),
      storage.getOnboardingTemplateTasks(id),
      storage.getOnboardingTemplateScopes(id),
    ]);
    return { ...t, sections, tasks, scopes };
  }

  async function loadFlexibleOffboardingTemplate(id: string) {
    const t = await storage.getOffboardingTemplate(id);
    if (!t) return null;
    const [sections, tasks, scopes] = await Promise.all([
      storage.getOffboardingTemplateSections(id),
      storage.getOffboardingTemplateTasks(id),
      storage.getOffboardingTemplateScopes(id),
    ]);
    return { ...t, sections, tasks, scopes };
  }

  app.get("/api/onboarding-templates/:id/full", requireAuth, requirePermission("users.view"), async (req, res) => {
    const t = await loadFlexibleOnboardingTemplate(String(req.params.id));
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    res.json(t);
  });
  app.get("/api/offboarding-templates/:id/full", requireAuth, requirePermission("users.view"), async (req, res) => {
    const t = await loadFlexibleOffboardingTemplate(String(req.params.id));
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    res.json(t);
  });

  // Sections (onboarding)
  app.post("/api/onboarding-templates/:templateId/sections", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOnboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const parsed = insertOnboardingTemplateSectionSchema.safeParse({ ...req.body, templateId: parent.id });
    if (!parsed.success) return res.status(400).json({ message: "Invalid section", errors: parsed.error.flatten() });
    const created = await storage.createOnboardingTemplateSection(parsed.data);
    res.status(201).json(created);
  });
  app.patch("/api/onboarding-template-sections/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateSectionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid section", errors: parsed.error.flatten() });
    delete (parsed.data as any).templateId;
    const updated = await storage.updateOnboardingTemplateSection(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Section not found" });
    res.json(updated);
  });
  app.delete("/api/onboarding-template-sections/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    await storage.deleteOnboardingTemplateSection(String(req.params.id));
    res.status(204).end();
  });

  // Sections (offboarding)
  app.post("/api/offboarding-templates/:templateId/sections", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOffboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const parsed = insertOffboardingTemplateSectionSchema.safeParse({ ...req.body, templateId: parent.id });
    if (!parsed.success) return res.status(400).json({ message: "Invalid section", errors: parsed.error.flatten() });
    const created = await storage.createOffboardingTemplateSection(parsed.data);
    res.status(201).json(created);
  });
  app.patch("/api/offboarding-template-sections/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateSectionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid section", errors: parsed.error.flatten() });
    delete (parsed.data as any).templateId;
    const updated = await storage.updateOffboardingTemplateSection(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Section not found" });
    res.json(updated);
  });
  app.delete("/api/offboarding-template-sections/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    await storage.deleteOffboardingTemplateSection(String(req.params.id));
    res.status(204).end();
  });

  // Scopes
  const scopeListSchema = z.object({
    scopes: z.array(z.object({
      scopeKind: z.enum(["company", "location", "department", "role", "employment_type"]),
      scopeRef: z.string().min(1),
    })),
  });
  app.put("/api/onboarding-templates/:templateId/scopes", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOnboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const parsed = scopeListSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid scopes", errors: parsed.error.flatten() });
    const out = await storage.setOnboardingTemplateScopes(parent.id, parsed.data.scopes);
    res.json(out);
  });
  app.put("/api/offboarding-templates/:templateId/scopes", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOffboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const parsed = scopeListSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid scopes", errors: parsed.error.flatten() });
    const out = await storage.setOffboardingTemplateScopes(parent.id, parsed.data.scopes);
    res.json(out);
  });

  // Suggestions for a hire
  app.get("/api/lifecycle/suggest-templates/:employeeId", requireAuth, requirePermission("users.view"), async (req, res) => {
    const employee = await storage.getUser(String(req.params.employeeId));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const [onboarding, offboarding] = await Promise.all([
      storage.suggestOnboardingTemplatesForEmployee(employee),
      storage.suggestOffboardingTemplatesForEmployee(employee),
    ]);
    res.json({ onboarding, offboarding });
  });

  // Duplicate
  app.post("/api/onboarding-templates/:id/duplicate", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const src = await storage.getOnboardingTemplate(String(req.params.id));
    if (!src) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, src, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const dup = await storage.duplicateOnboardingTemplate(src.id, actor.id);
    res.status(201).json(dup);
  });
  app.post("/api/offboarding-templates/:id/duplicate", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const src = await storage.getOffboardingTemplate(String(req.params.id));
    if (!src) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, src, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    const dup = await storage.duplicateOffboardingTemplate(src.id, actor.id);
    res.status(201).json(dup);
  });

  // Delete template
  app.delete("/api/onboarding-templates/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const t = await storage.getOnboardingTemplate(String(req.params.id));
    if (!t) return res.status(204).end();
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    await storage.deleteOnboardingTemplate(t.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template.delete", actorUserId: actor.id, targetType: "onboarding_template", targetId: t.id, oldValue: t, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });
  app.delete("/api/offboarding-templates/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const t = await storage.getOffboardingTemplate(String(req.params.id));
    if (!t) return res.status(204).end();
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
    await storage.deleteOffboardingTemplate(t.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template.delete", actorUserId: actor.id, targetType: "offboarding_template", targetId: t.id, oldValue: t, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });

  // Per-checklist add/remove tasks
  const checklistAddTaskSchema = z.object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),
    category: z.string().min(1).optional(),
    sectionTitle: z.string().nullable().optional(),
    sectionSortOrder: z.number().int().optional(),
    taskType: z.enum(["checkbox", "document", "signature", "link", "free_text", "file"]).optional(),
    ownerKind: z.enum(["role", "user", "department", "new_hire", "departing_employee"]).optional(),
    ownerRole: z.string().optional(),
    ownerUserId: z.string().nullable().optional(),
    ownerDepartmentId: z.string().nullable().optional(),
    isRequired: z.boolean().optional(),
    blocksDeactivation: z.boolean().optional(),
    documentType: z.string().nullable().optional(),
    linkUrl: z.string().nullable().optional(),
    customFields: z.any().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  });
  app.post("/api/onboarding-checklists/:id/tasks", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const cl = await storage.getOnboardingChecklist(String(req.params.id));
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    const parsed = checklistAddTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const created = await storage.addTaskToOnboardingChecklist(cl.id, parsed.data as any);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_checklist.task.add", actorUserId: (req as any).authUser.id, targetType: "onboarding_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });
  app.delete("/api/onboarding-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const t = await storage.getOnboardingTask(String(req.params.id));
    if (!t) return res.status(204).end();
    await storage.deleteOnboardingTaskRow(t.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_checklist.task.delete", actorUserId: (req as any).authUser.id, targetType: "onboarding_task", targetId: t.id, oldValue: t, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });
  app.post("/api/offboarding-checklists/:id/tasks", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const cl = await storage.getOffboardingChecklist(String(req.params.id));
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    const parsed = checklistAddTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const created = await storage.addTaskToOffboardingChecklist(cl.id, parsed.data as any);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_checklist.task.add", actorUserId: (req as any).authUser.id, targetType: "offboarding_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });
  app.delete("/api/offboarding-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const t = await storage.getOffboardingTask(String(req.params.id));
    if (!t) return res.status(204).end();
    await storage.deleteOffboardingTaskRow(t.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_checklist.task.delete", actorUserId: (req as any).authUser.id, targetType: "offboarding_task", targetId: t.id, oldValue: t, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });

  // Propagate template task changes to in-progress checklists
  const propagateSchema = z.object({ kind: z.enum(["onboarding", "offboarding"]) });
  app.post("/api/lifecycle-templates/:id/propagate", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = propagateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid propagate request" });
    const actor = (req as any).authUser as User;
    const tid = String(req.params.id);
    let propagated = 0;
    if (parsed.data.kind === "onboarding") {
      const tpl = await storage.getOnboardingTemplate(tid);
      if (!tpl) return res.status(404).json({ message: "Template not found" });
      if (!actorCanAccessLifecycleTemplate(actor, tpl, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
      const checklists = await storage.listOnboardingChecklists({ status: "in_progress" });
      const ours = checklists.filter(c => c.templateId === tid);
      const [tpls, sections] = await Promise.all([
        storage.getOnboardingTemplateTasks(tid),
        storage.getOnboardingTemplateSections(tid),
      ]);
      const sectionMap = new Map(sections.map(s => [s.id, s]));
      for (const cl of ours) {
        const existing = await storage.getOnboardingTasks(cl.id);
        const existingTplIds = new Set(existing.map(e => e.templateTaskId).filter(Boolean));
        for (const t of tpls) {
          if (existingTplIds.has(t.id)) continue;
          const section = t.sectionId ? sectionMap.get(t.sectionId) : null;
          await storage.addTaskToOnboardingChecklist(cl.id, {
            title: t.title,
            description: t.description,
            instructions: t.instructions ?? null,
            category: t.category,
            sectionTitle: section?.title ?? null,
            sectionSortOrder: section?.sortOrder ?? 0,
            taskType: t.taskType ?? "checkbox",
            ownerKind: t.ownerKind ?? "role",
            ownerRole: t.ownerRole,
            ownerUserId: t.ownerUserId ?? null,
            ownerDepartmentId: t.ownerDepartmentId ?? null,
            isRequired: t.isRequired,
            documentType: t.documentType,
            linkUrl: t.linkUrl ?? null,
            customFields: (t.customFields ?? null) as any,
            sortOrder: t.sortOrder,
          } as any);
          propagated++;
        }
      }
    } else {
      const tpl = await storage.getOffboardingTemplate(tid);
      if (!tpl) return res.status(404).json({ message: "Template not found" });
      if (!actorCanAccessLifecycleTemplate(actor, tpl, isSuperAdmin(req))) return res.status(403).json({ message: "Forbidden" });
      const checklists = await storage.listOffboardingChecklists({ status: "in_progress" });
      const ours = checklists.filter(c => c.templateId === tid);
      const [tpls, sections] = await Promise.all([
        storage.getOffboardingTemplateTasks(tid),
        storage.getOffboardingTemplateSections(tid),
      ]);
      const sectionMap = new Map(sections.map(s => [s.id, s]));
      for (const cl of ours) {
        const existing = await storage.getOffboardingTasks(cl.id);
        const existingTplIds = new Set(existing.map(e => e.templateTaskId).filter(Boolean));
        for (const t of tpls) {
          if (existingTplIds.has(t.id)) continue;
          const section = t.sectionId ? sectionMap.get(t.sectionId) : null;
          await storage.addTaskToOffboardingChecklist(cl.id, {
            title: t.title,
            description: t.description,
            instructions: t.instructions ?? null,
            category: t.category,
            sectionTitle: section?.title ?? null,
            sectionSortOrder: section?.sortOrder ?? 0,
            taskType: t.taskType ?? "checkbox",
            ownerKind: t.ownerKind ?? "role",
            ownerRole: t.ownerRole,
            ownerUserId: t.ownerUserId ?? null,
            ownerDepartmentId: t.ownerDepartmentId ?? null,
            isRequired: t.isRequired,
            blocksDeactivation: t.blocksDeactivation,
            linkUrl: t.linkUrl ?? null,
            customFields: (t.customFields ?? null) as any,
            sortOrder: t.sortOrder,
          } as any);
          propagated++;
        }
      }
    }
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "lifecycle_template.propagate", actorUserId: actor.id, targetType: `${parsed.data.kind}_template`, targetId: tid, newValue: { propagated }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json({ propagated });
  });

  // ===================== Lifecycle Wizards: Offboarding =====================

  app.get("/api/offboarding-templates", requireAuth, requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    const requestedCompanyId = (req.query.companyId as string | undefined) ?? actor.companyId ?? null;
    if (!isSuperAdmin(req) && requestedCompanyId !== null && requestedCompanyId !== (actor.companyId ?? null)) {
      return res.status(403).json({ message: "Forbidden: cannot list templates for another company" });
    }
    const templates = await storage.getOffboardingTemplates({ companyId: requestedCompanyId });
    res.json(templates);
  });

  app.get("/api/offboarding-templates/:id", requireAuth, requirePermission("users.view"), async (req, res) => {
    const t = await storage.getOffboardingTemplate(String(req.params.id));
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const tasks = await storage.getOffboardingTemplateTasks(t.id);
    res.json({ ...t, tasks });
  });

  app.post("/api/offboarding-templates", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateSchema.safeParse({
      ...req.body,
      createdBy: (req as any).authUser?.id ?? null,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const actor = (req as any).authUser as User;
    // Only super-admin may create global (companyId=null) or cross-company templates.
    // Tenant admins are forced to their own company scope regardless of input.
    if (!isSuperAdmin(req)) {
      const cid = parsed.data.companyId ?? null;
      if (cid !== null && cid !== (actor.companyId ?? null)) {
        return res.status(403).json({ message: "Forbidden: cannot create template for another company" });
      }
      if (cid === null) {
        if (!actor.companyId) {
          return res.status(403).json({ message: "Forbidden: cannot create global template" });
        }
        parsed.data.companyId = actor.companyId;
      }
    }
    const created = await storage.createOffboardingTemplate(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template.create", actorUserId: (req as any).authUser.id, targetType: "offboarding_template", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/offboarding-templates/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const before = await storage.getOffboardingTemplate(String(req.params.id));
    if (!before) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, before, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!isSuperAdmin(req) && "companyId" in parsed.data) {
      const cid = parsed.data.companyId ?? null;
      // Tenant admins cannot reassign to another company AND cannot promote
      // a template to global (companyId=null).
      if (cid === null || cid !== (actor.companyId ?? null)) {
        return res.status(403).json({ message: "Forbidden: cannot reassign template scope" });
      }
    }
    const updated = await storage.updateOffboardingTemplate(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Template not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template.update", actorUserId: (req as any).authUser.id, targetType: "offboarding_template", targetId: updated.id, oldValue: before, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.post("/api/offboarding-templates/:templateId/tasks", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOffboardingTemplate(String(req.params.templateId));
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const parsed = insertOffboardingTemplateTaskSchema.safeParse({ ...req.body, templateId: String(req.params.templateId) });
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const created = await storage.createOffboardingTemplateTask(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.create", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/offboarding-template-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateTaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const existingTask = await storage.getOffboardingTemplateTask(String(req.params.id));
    if (!existingTask) return res.status(404).json({ message: "Task not found" });
    const parent = await storage.getOffboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    // Re-parenting a template task across templates is not supported via this
    // endpoint. Disallow `templateId` mutation to prevent cross-scope IDOR.
    if ("templateId" in parsed.data && parsed.data.templateId !== existingTask.templateId) {
      return res.status(400).json({ message: "Cannot change templateId of a template task" });
    }
    delete (parsed.data as Record<string, unknown>).templateId;
    const updated = await storage.updateOffboardingTemplateTask(String(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.update", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: updated.id, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.delete("/api/offboarding-template-tasks/:id", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const existingTask = await storage.getOffboardingTemplateTask(String(req.params.id));
    if (!existingTask) return res.status(204).end();
    const parent = await storage.getOffboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.deleteOffboardingTemplateTask(String(req.params.id));
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.delete", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: String(req.params.id), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });

  app.get("/api/offboarding-checklists", requireAuth, requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    const params: { status?: string; employeeIds?: string[] } = {};
    if (typeof req.query.status === "string") params.status = req.query.status;
    if (actor.role === "manager") {
      const team = await getTeamUserIds(actor);
      params.employeeIds = Array.from(team);
    }
    const checklists = await storage.listOffboardingChecklists(params);
    res.json(checklists);
  });

  app.get("/api/offboarding-checklists/by-employee/:employeeId", requireAuth, requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    if (actor.role === "manager") {
      const team = await getTeamUserIds(actor);
      if (!team.has(String(req.params.employeeId))) return res.status(403).json({ message: "Forbidden" });
    }
    const cl = await storage.getOffboardingChecklistByEmployee(String(req.params.employeeId));
    if (!cl) return res.json(null);
    const tasks = await storage.getOffboardingTasks(cl.id);
    const gate = await evaluateDeactivationGate(cl.id);
    const progress = await storage.computeOffboardingProgress(cl.id);
    res.json({ ...cl, tasks, gate, progress });
  });

  app.get("/api/offboarding-checklists/:id", requireAuth, requirePermission("users.view"), async (req, res) => {
    const cl = await storage.getOffboardingChecklist(String(req.params.id));
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    const actor = (req as any).authUser as User;
    if (actor.role === "manager") {
      const team = await getTeamUserIds(actor);
      if (!team.has(cl.employeeId)) return res.status(403).json({ message: "Forbidden" });
    }
    const tasks = await storage.getOffboardingTasks(cl.id);
    const gate = await evaluateDeactivationGate(cl.id);
    const progress = await storage.computeOffboardingProgress(cl.id);
    res.json({ ...cl, tasks, gate, progress });
  });

  const startOffboardingSchema = z.object({
    employeeId: z.string().min(1),
    templateId: z.string().optional().nullable(),
    terminationDate: z.string().optional().nullable(),
  });
  app.post("/api/offboarding/start", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const parsed = startOffboardingSchema.safeParse(req.body);
    if (!parsed.success) return badRequestFromZod(res, parsed, "Invalid offboarding request");
    const employee = await storage.getUser(parsed.data.employeeId);
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const ctx = getAuditContext(req);
    const cl = await materializeOffboardingChecklist(employee, {
      templateId: parsed.data.templateId ?? null,
      terminationDate: parsed.data.terminationDate ?? null,
      startedBy: (req as any).authUser.id,
      context: { ip: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
    });
    if (!cl) return res.status(409).json({ message: "Could not start offboarding (no template available)" });
    res.status(201).json(cl);
  });

  const updateOffboardingTaskSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
    notes: z.string().nullable().optional(),
    skippedReason: z.string().nullable().optional(),
  });
  app.patch("/api/offboarding-tasks/:id", requireAuth, requirePermission("offboarding.update_tasks"), async (req, res) => {
    const parsed = updateOffboardingTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid task update", errors: parsed.error.flatten() });
    const task = await storage.getOffboardingTask(String(req.params.id));
    if (!task) return res.status(404).json({ message: "Task not found" });
    const checklist = await storage.getOffboardingChecklist(task.checklistId);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });
    const actor = (req as any).authUser as User;
    const isAdmin = actor.role === "admin";
    if (!isAdmin) {
      const team = await getTeamUserIds(actor);
      if (!team.has(checklist.employeeId)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Owner-role alignment: managers may only mutate ownerRole 'manager' or 'it'.
      if (task.ownerRole !== "manager" && task.ownerRole !== "it") {
        return res.status(403).json({ message: "Manager role cannot update this task type" });
      }
    }
    if (parsed.data.status === "skipped" && !parsed.data.skippedReason) {
      return res.status(400).json({ message: "skippedReason is required when skipping" });
    }
    const completing = parsed.data.status === "completed";
    const updated = await storage.updateOffboardingTask(String(req.params.id), {
      status: parsed.data.status,
      notes: "notes" in parsed.data ? parsed.data.notes : undefined,
      skippedReason: "skippedReason" in parsed.data ? parsed.data.skippedReason : undefined,
      completedAt: completing ? new Date() : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
      completedBy: completing ? actor.id : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
    });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_task.update", actorUserId: actor.id, targetType: "offboarding_task", targetId: String(req.params.id), oldValue: task, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.post("/api/offboarding-checklists/:id/deactivate", requireAuth, requirePermission("users.edit"), async (req, res) => {
    const cl = await storage.getOffboardingChecklist(String(req.params.id));
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    if (cl.employeeId === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const gate = await evaluateDeactivationGate(String(req.params.id));
    if (!gate.ok) {
      return res.status(409).json({ message: "Cannot deactivate: blocking tasks remain", blocking: gate.blocking });
    }
    const actor = (req as any).authUser as User;
    const ctx = getAuditContext(req);

    const terminationDate = cl.terminationDate ?? new Date().toISOString().slice(0, 10);

    // Termination must be written to the employment profile before we
    // deactivate the user. Failure here aborts deactivation entirely.
    const profile = await storage.getEmploymentProfile(cl.employeeId);
    if (!profile) {
      return res.status(409).json({ message: "Cannot deactivate: employment profile is missing" });
    }
    const updatedProfile = await storage.updateEmploymentProfile(cl.employeeId, { terminationDate });
    if (!updatedProfile) {
      return handleRouteError(
        res,
        new Error("employment profile update returned no row"),
        "Failed to write termination date to employment profile",
      );
    }

    await storage.setUserDeactivated(cl.employeeId, actor.id);
    const updated = await storage.setOffboardingChecklistDeactivation(String(req.params.id), actor.id);

    await writeAuditLog({ action: "user.deactivate", actorUserId: actor.id, targetType: "user", targetId: cl.employeeId, newValue: { checklistId: cl.id, terminationDate }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    // Per arch §6: explicit checklist state-transition audit alongside the
    // user-level event so the offboarding lifecycle has its own trail.
    await writeAuditLog({
      action: "offboarding_checklist.deactivate",
      actorUserId: actor.id,
      targetType: "offboarding_checklist",
      targetId: cl.id,
      oldValue: cl,
      newValue: updated,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    res.json(updated);
  });

  app.post("/api/users/:id/reactivate", requireAuth, async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ message: "Only super admin can reactivate users" });
    const u = await storage.getUser(String(req.params.id));
    if (!u) return res.status(404).json({ message: "User not found" });
    const updated = await storage.clearUserDeactivated(String(req.params.id));
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "user.reactivate", actorUserId: (req as any).authUser.id, targetType: "user", targetId: String(req.params.id), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  // ====================================================================
  // ===== Biometric kiosk (Task 106 — Phase 1: face recognition) =======
  // ====================================================================

  // Lazy-import service helpers to keep startup lean and to avoid a circular
  // dependency between routes and services that import storage.
  const {
    encryptTemplate,
    decryptTemplate,
    getCurrentKeyVersion,
    isUsingEphemeralKey,
  } = await import("./services/biometricEncryption");
  const { identify } = await import("./services/biometricMatcher");
  const { resolveLegalProfileForUser } = await import("./services/biometricLegalProfile");
  const { runBiometricRetention } = await import("./services/biometricRetention");

  // Validate a kiosk identifies itself with a known active device. The header is the
  // contract: kiosks set X-Kiosk-Device-Id from the device profile they were paired
  // with. This is "kiosk-only device trust" — face-identify cannot be invoked from a
  // browser session that isn't asserting an active kiosk device.
  async function getKioskDeviceFromReq(req: any) {
    const headerVal = req.headers?.["x-kiosk-device-id"];
    const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!deviceId || typeof deviceId !== "string") return null;
    const device = await storage.getKioskDevice(deviceId);
    if (!device || !device.isActive) return null;
    // Kiosk devices link to a department; the department gives us the companyId we
    // need to scope candidate face templates. Devices with no department fall back to
    // null which means no candidates will match (safe-by-default).
    let companyId: string | null = null;
    if (device.departmentId) {
      const dept = await storage.getDepartment(device.departmentId);
      companyId = dept?.companyId ?? null;
    }
    return { ...device, companyId };
  }

  function isFeatureEnabled(settings: { featureEnabled: boolean; faceEnabled: boolean }) {
    return settings.featureEnabled && settings.faceEnabled;
  }

  // ---- Settings (admin) ----
  app.get(
    "/api/biometrics/settings",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (_req, res) => {
      const settings = await storage.getBiometricSettings();
      res.json({ settings, encryptionKeyEphemeral: isUsingEphemeralKey() });
    },
  );

  app.patch(
    "/api/biometrics/settings",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const before = await storage.getBiometricSettings();
      const allowed = [
        "featureEnabled",
        "faceEnabled",
        "thresholdAutoApprove",
        "thresholdReview",
        "thresholdReject",
        "livenessRequired",
        "maxAttemptsBeforeLockout",
        "lockoutDurationMinutes",
        "supervisorOverrideRequiresPin",
        "minSamplesPerEnrollment",
        "maxSamplesPerEnrollment",
        "matchTimeoutMs",
      ] as const;
      const patch: Record<string, unknown> = {};
      for (const k of allowed) {
        if (req.body && k in req.body) patch[k] = req.body[k];
      }
      const updated = await storage.updateBiometricSettings(patch as any, (req as any).authUser.id);
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_settings",
        targetId: updated.id,
        action: "biometric.settings.updated",
        oldValue: before,
        newValue: updated,
        context: getAuditContext(req),
      });
      res.json({ settings: updated });
    },
  );

  // ---- Legal profiles (admin) ----
  app.get(
    "/api/biometrics/legal-profiles",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (_req, res) => {
      const profiles = await storage.getBiometricLegalProfiles();
      const scopes = await storage.getBiometricLegalProfileScopes();
      res.json({ profiles, scopes });
    },
  );

  app.post(
    "/api/biometrics/legal-profiles",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const body = req.body || {};
      if (!body.name || !body.consentText) {
        return res.status(400).json({ error: "name and consentText are required" });
      }
      const created = await storage.createBiometricLegalProfile({
        name: body.name,
        description: body.description ?? null,
        consentText: body.consentText,
        consentVersion: body.consentVersion ?? 1,
        retentionDays: body.retentionDays ?? 180,
        isEnabled: false,
        isDefault: false,
      });
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_legal_profile",
        targetId: created.id,
        action: "biometric.legal_profile.created",
        newValue: created,
        context: getAuditContext(req),
      });
      res.json(created);
    },
  );

  app.patch(
    "/api/biometrics/legal-profiles/:id",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const id = String(req.params.id);
      const before = await storage.getBiometricLegalProfile(id);
      if (!before) return res.status(404).json({ error: "Not found" });
      const allowed = ["name", "description", "consentText", "consentVersion", "retentionDays", "isEnabled"] as const;
      const patch: Record<string, unknown> = {};
      for (const k of allowed) {
        if (req.body && k in req.body) patch[k] = req.body[k];
      }
      // If the consent text changed, force version bump so existing consents become "stale".
      if (typeof patch.consentText === "string" && patch.consentText !== before.consentText) {
        patch.consentVersion = (before.consentVersion || 1) + 1;
      }
      const updated = await storage.updateBiometricLegalProfile(id, patch as any);
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_legal_profile",
        targetId: id,
        action: "biometric.legal_profile.updated",
        oldValue: before,
        newValue: updated,
        context: getAuditContext(req),
      });
      res.json(updated);
    },
  );

  app.delete(
    "/api/biometrics/legal-profiles/:id",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const id = String(req.params.id);
      const before = await storage.getBiometricLegalProfile(id);
      if (!before) return res.status(404).json({ error: "Not found" });
      if (before.isDefault) {
        return res.status(400).json({ error: "Cannot delete the default profile" });
      }
      await storage.deleteBiometricLegalProfile(id);
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_legal_profile",
        targetId: id,
        action: "biometric.legal_profile.deleted",
        oldValue: before,
        context: getAuditContext(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/biometrics/legal-profiles/:id/scopes",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const id = String(req.params.id);
      const profile = await storage.getBiometricLegalProfile(id);
      if (!profile) return res.status(404).json({ error: "Not found" });
      const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
      const cleaned = scopes
        .filter((s: any) => s && (s.companyId || s.locationId))
        .map((s: any) => ({ companyId: s.companyId ?? null, locationId: s.locationId ?? null }));
      const result = await storage.setBiometricLegalProfileScopes(id, cleaned);
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_legal_profile",
        targetId: id,
        action: "biometric.legal_profile.scopes_set",
        newValue: { scopes: cleaned },
        context: getAuditContext(req),
      });
      res.json({ scopes: result });
    },
  );

  // ---- Employee self-service ----
  app.get("/api/biometrics/me", requireAuth, async (req: any, res) => {
    const userId = (req as any).authUser.id;
    const settings = await storage.getBiometricSettings();
    const profile = await resolveLegalProfileForUser(userId);
    const consent = await storage.getActiveBiometricConsent(userId);
    const template = await storage.getBiometricTemplate(userId, "face");
    res.json({
      featureEnabled: isFeatureEnabled(settings),
      profile: profile
        ? {
            id: profile.id,
            name: profile.name,
            consentText: profile.consentText,
            consentVersion: profile.consentVersion,
            isEnabled: profile.isEnabled,
            retentionDays: profile.retentionDays,
          }
        : null,
      hasConsent: !!consent && (consent.consentVersion === profile?.consentVersion),
      consentAcceptedAt: consent?.acceptedAt ?? null,
      enrolled: !!template,
      sampleCount: template?.sampleCount ?? 0,
      lastMatchedAt: template?.lastMatchedAt ?? null,
      legalHold: !!consent?.legalHold,
      requiredSamples: settings.minSamplesPerEnrollment,
      maxSamples: settings.maxSamplesPerEnrollment,
      livenessRequired: settings.livenessRequired,
    });
  });

  app.post("/api/biometrics/consent", requireAuth, async (req: any, res) => {
    const userId = (req as any).authUser.id;
    const settings = await storage.getBiometricSettings();
    if (!isFeatureEnabled(settings)) {
      return res.status(403).json({ error: "Biometric feature is not enabled" });
    }
    const profile = await resolveLegalProfileForUser(userId);
    if (!profile || !profile.isEnabled) {
      return res.status(403).json({ error: "No enabled legal profile applies to your account" });
    }
    if (req.body?.consentVersion !== profile.consentVersion) {
      return res
        .status(409)
        .json({ error: "Consent version mismatch — please re-read the latest consent" });
    }
    const ctx = getAuditContext(req);
    const created = await storage.createBiometricConsent({
      userId,
      legalProfileId: profile.id,
      consentVersion: profile.consentVersion,
      consentTextSnapshot: profile.consentText,
      acceptedIp: ctx.ipAddress ?? null,
      acceptedUserAgent: ctx.userAgent ?? null,
    });
    await writeAuditLog({
      actorUserId: userId,
      targetType: "biometric_consent",
      targetId: created.id,
      action: "biometric.consent.accepted",
      newValue: { legalProfileId: profile.id, consentVersion: profile.consentVersion },
      context: ctx,
    });
    res.json({ consent: created });
  });

  app.delete("/api/biometrics/consent", requireAuth, async (req: any, res) => {
    const userId = (req as any).authUser.id;
    await storage.revokeBiometricConsent(userId, userId, "self_revoke");
    await storage.deleteBiometricTemplate(userId, "face");
    await writeAuditLog({
      actorUserId: userId,
      targetType: "biometric_consent",
      targetId: userId,
      action: "biometric.consent.revoked",
      newValue: { reason: "self_revoke" },
      context: getAuditContext(req),
    });
    res.json({ ok: true });
  });

  app.post("/api/biometrics/face/enroll", requireAuth, async (req: any, res) => {
    const userId = (req as any).authUser.id;
    const settings = await storage.getBiometricSettings();
    if (!isFeatureEnabled(settings)) {
      return res.status(403).json({ error: "Biometric feature is not enabled" });
    }
    const profile = await resolveLegalProfileForUser(userId);
    if (!profile || !profile.isEnabled) {
      return res.status(403).json({ error: "No enabled legal profile applies to your account" });
    }
    const consent = await storage.getActiveBiometricConsent(userId);
    if (!consent || consent.consentVersion !== profile.consentVersion) {
      return res.status(412).json({ error: "Active consent required before enrollment" });
    }
    const descriptors = req.body?.descriptors;
    if (!Array.isArray(descriptors) || descriptors.length < settings.minSamplesPerEnrollment) {
      return res.status(400).json({
        error: `At least ${settings.minSamplesPerEnrollment} face samples are required`,
      });
    }
    if (descriptors.length > settings.maxSamplesPerEnrollment) {
      return res
        .status(400)
        .json({ error: `Too many samples (max ${settings.maxSamplesPerEnrollment})` });
    }
    for (const d of descriptors) {
      if (!Array.isArray(d) || d.length !== 128 || d.some((x: any) => typeof x !== "number")) {
        return res.status(400).json({ error: "Each descriptor must be 128 numeric values" });
      }
    }
    const user = await storage.getUser(userId);
    const encrypted = encryptTemplate(descriptors);
    const template = await storage.upsertBiometricTemplate({
      userId,
      type: "face",
      encryptedTemplate: encrypted,
      encryptionKeyVersion: getCurrentKeyVersion(),
      sampleCount: descriptors.length,
      companyId: user?.companyId ?? null,
      enrolledByUserId: userId,
    });
    await writeAuditLog({
      actorUserId: userId,
      targetType: "biometric_template",
      targetId: template.id,
      action: "biometric.template.enrolled",
      newValue: { type: "face", sampleCount: descriptors.length },
      context: getAuditContext(req),
    });
    res.json({ ok: true, template: { id: template.id, sampleCount: template.sampleCount } });
  });

  app.delete("/api/biometrics/face/enroll", requireAuth, async (req: any, res) => {
    const userId = (req as any).authUser.id;
    await storage.deleteBiometricTemplate(userId, "face");
    await writeAuditLog({
      actorUserId: userId,
      targetType: "biometric_template",
      targetId: userId,
      action: "biometric.template.deleted",
      newValue: { reason: "self_delete", type: "face" },
      context: getAuditContext(req),
    });
    res.json({ ok: true });
  });

  // ---- Admin governance ----
  app.get(
    "/api/biometrics/enrollments",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (_req, res) => {
      const rows = await storage.getBiometricEnrollmentSummary();
      res.json(rows);
    },
  );

  app.get(
    "/api/biometrics/attempts",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req, res) => {
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const limit = Math.min(parseInt((req.query.limit as string) || "200", 10) || 200, 500);
      const attempts = await storage.listBiometricAttempts({
        outcome: (req.query.outcome as string) || undefined,
        candidateUserId: (req.query.userId as string) || undefined,
        since,
        limit,
      });
      res.json(attempts);
    },
  );

  app.get(
    "/api/biometrics/overrides",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req, res) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10) || 100, 500);
      const rows = await storage.listBiometricSupervisorOverrides(limit);
      res.json(rows);
    },
  );

  app.get(
    "/api/biometrics/metrics",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req, res) => {
      const days = Math.max(1, Math.min(parseInt((req.query.days as string) || "30", 10) || 30, 365));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const metrics = await storage.getBiometricMetrics(since);
      res.json({ since, days, ...metrics });
    },
  );

  app.post(
    "/api/biometrics/users/:id/revoke",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const userId = String(req.params.id);
      const reason = (req.body?.reason as string) || "admin_revoke";
      await storage.revokeBiometricConsent(userId, (req as any).authUser.id, reason);
      await storage.deleteBiometricTemplate(userId, "face");
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_consent",
        targetId: userId,
        action: "biometric.admin.revoked",
        newValue: { reason },
        context: getAuditContext(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/biometrics/users/:id/legal-hold",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const userId = String(req.params.id);
      const hold = !!req.body?.hold;
      await storage.setBiometricLegalHold(userId, hold);
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_consent",
        targetId: userId,
        action: hold ? "biometric.legal_hold.placed" : "biometric.legal_hold.released",
        context: getAuditContext(req),
      });
      res.json({ ok: true });
    },
  );

  // Admin-initiated, consent-gated enrollment. An admin captures the employee's
  // face at the admin's own device and saves the template attributed to the
  // acting admin. Strictly requires an ACTIVE consent on file for the target —
  // admins may NOT enroll employees who have not recorded consent (BIPA).
  app.post(
    "/api/biometrics/users/:id/enroll",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const targetUserId = String(req.params.id);
      const settings = await storage.getBiometricSettings();
      if (!isFeatureEnabled(settings)) {
        return res.status(403).json({ error: "Biometric feature is not enabled" });
      }
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: "Employee not found" });
      }
      const consent = await storage.getActiveBiometricConsent(targetUserId);
      if (!consent) {
        return res
          .status(412)
          .json({ error: "Employee must have an active consent on file before enrollment" });
      }
      const descriptors = req.body?.descriptors;
      if (!Array.isArray(descriptors) || descriptors.length < settings.minSamplesPerEnrollment) {
        return res.status(400).json({
          error: `At least ${settings.minSamplesPerEnrollment} face samples are required`,
        });
      }
      if (descriptors.length > settings.maxSamplesPerEnrollment) {
        return res
          .status(400)
          .json({ error: `Too many samples (max ${settings.maxSamplesPerEnrollment})` });
      }
      for (const d of descriptors) {
        if (!Array.isArray(d) || d.length !== 128 || d.some((x: any) => typeof x !== "number")) {
          return res.status(400).json({ error: "Each descriptor must be 128 numeric values" });
        }
      }
      const adminId = (req as any).authUser.id;
      const encrypted = encryptTemplate(descriptors);
      const template = await storage.upsertBiometricTemplate({
        userId: targetUserId,
        type: "face",
        encryptedTemplate: encrypted,
        encryptionKeyVersion: getCurrentKeyVersion(),
        sampleCount: descriptors.length,
        companyId: targetUser.companyId ?? null,
        enrolledByUserId: adminId,
      });
      await writeAuditLog({
        actorUserId: adminId,
        targetType: "biometric_template",
        targetId: template.id,
        action: "biometric.admin.enrolled",
        newValue: { type: "face", sampleCount: descriptors.length, targetUserId },
        context: getAuditContext(req),
      });
      res.json({ ok: true, template: { id: template.id, sampleCount: template.sampleCount } });
    },
  );

  app.post(
    "/api/biometrics/retention/run",
    requireAuth,
    requirePermission("biometrics.manage"),
    async (req: any, res) => {
      const result = await runBiometricRetention();
      await writeAuditLog({
        actorUserId: (req as any).authUser.id,
        targetType: "biometric_settings",
        targetId: "global",
        action: "biometric.retention.manual_run",
        newValue: result,
        context: getAuditContext(req),
      });
      res.json(result);
    },
  );

  // kiosk_devices has no `companyId` column. Resolve via the device's
  // departmentId → department → (companyId | location → companyId) chain.
  // Returns null when the device isn't scoped to any company (templates with
  // a null companyId are then considered, matching legacy behavior).
  async function resolveKioskDeviceCompanyId(
    device: { departmentId: string | null },
  ): Promise<string | null> {
    if (!device.departmentId) return null;
    const dept = await storage.getDepartment(device.departmentId);
    if (!dept) return null;
    if (dept.companyId) return dept.companyId;
    if (dept.locationId) {
      const loc = await storage.getLocation(dept.locationId);
      if (loc?.companyId) return loc.companyId;
    }
    return null;
  }

  const kioskSupervisorOverrideSchema = z.object({
    supervisorPin: z.string().min(1),
    targetEmployeeId: z.string().min(1),
    reason: z.string().min(1).optional(),
    attemptId: z.string().optional(),
    punchType: z.enum(["clock_in", "clock_out"]).default("clock_in"),
  });

  // ---- Kiosk public face flow ----
  app.post("/api/kiosk/face/identify", wrapKiosk(async (req, res) => {
    const device = await requireKioskDevice(req, res);
    if (!device) return;
    const settings = await storage.getBiometricSettings();
    if (!isFeatureEnabled(settings)) {
      return kioskError(res, 503, "face_disabled", "Face login is currently disabled. Please use your PIN.");
    }
    const probe = req.body?.descriptor;
    if (!Array.isArray(probe) || probe.length !== 128 || probe.some((x: any) => typeof x !== "number")) {
      // Record camera/probe error so dashboard reflects bad-frames.
      await storage.recordBiometricAttempt({
        kioskDeviceId: device.id,
        outcome: "camera_error",
        confidence: null,
        livenessPassed: null,
      });
      return kioskError(res, 400, "camera_error", "We couldn't read the camera frame. Please try again.");
    }
    if (settings.livenessRequired && req.body?.livenessPassed !== true) {
      await storage.recordBiometricAttempt({
        kioskDeviceId: device.id,
        outcome: "liveness_failed",
        confidence: null,
        livenessPassed: false,
      });
      return kioskError(res, 400, "liveness_failed", "Liveness check failed. Please face the camera and try again.", { outcome: "liveness_failed" });
    }

    const deviceCompanyId = await resolveKioskDeviceCompanyId(device);
    const candidatesRaw = await storage.getBiometricTemplatesByCompanyAndType(
      deviceCompanyId,
      "face",
    );
    // Decrypt and project to matcher candidate shape. Skip rows that fail to decrypt
    // (could mean key rotation pending) so the flow degrades to PIN cleanly.
    const candidates = [] as { userId: string; descriptors: number[][]; templateId: string }[];
    for (const row of candidatesRaw) {
      try {
        const descriptors = decryptTemplate<number[][]>(row.encryptedTemplate);
        if (Array.isArray(descriptors) && descriptors.length > 0) {
          candidates.push({ userId: row.userId, descriptors, templateId: row.id });
        }
      } catch (err) {
        console.warn(`[biometric] could not decrypt template ${row.id}:`, (err as Error).message);
      }
    }

    const match = identify(probe, candidates, settings);

    // Record attempt + check consecutive failures for lockout signalling.
    let consecutiveFailures = 0;
    if (match.outcome !== "auto_approved" && match.userId) {
      consecutiveFailures = await storage.countConsecutiveFailures(
        match.userId,
        device.id,
        new Date(Date.now() - settings.lockoutDurationMinutes * 60 * 1000),
      );
    }

    const attempt = await storage.recordBiometricAttempt({
      kioskDeviceId: device.id,
      candidateUserId: match.userId,
      outcome: match.outcome,
      confidence: match.confidence,
      livenessPassed: settings.livenessRequired ? true : null,
    });
    if (match.outcome === "auto_approved" && match.userId) {
      const tplRow = candidatesRaw.find((r) => r.userId === match.userId);
      if (tplRow) await storage.touchBiometricTemplateMatched(tplRow.id);
      const user = await storage.getUser(match.userId);
      if (!user) {
        return kioskError(res, 404, "employee_not_found", "We couldn't find that employee.");
      }
      const deptName = await getDepartmentName(user.departmentId);
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      const kioskLastRecord = lastRecord
        ? {
            id: lastRecord.id,
            type: lastRecord.clockOut ? "clock_out" : lastRecord.clockIn ? "clock_in" : null,
            timestamp: lastRecord.clockOut || lastRecord.clockIn,
          }
        : null;
      const allowedPunchSources = await getKioskAllowedSourcesForUser(user);
      return res.json({
        outcome: "auto_approved",
        confidence: match.confidence,
        attemptId: attempt.id,
        employee: sanitizeUserForKiosk(user, deptName, allowedPunchSources),
        lastRecord: kioskLastRecord,
      });
    }
    return res.json({
      outcome: match.outcome,
      confidence: match.confidence,
      attemptId: attempt.id,
      consecutiveFailures,
      lockoutThreshold: settings.maxAttemptsBeforeLockout,
    });
  }));

  app.post("/api/kiosk/face/supervisor-override", wrapKiosk(async (req, res) => {
    const device = await requireKioskDevice(req, res);
    if (!device) return;
    const parsedOverride = kioskSupervisorOverrideSchema.safeParse(req.body ?? {});
    if (!parsedOverride.success) {
      return kioskError(res, 400, "invalid_request", "Supervisor PIN and employee are required.");
    }
    const { supervisorPin, targetEmployeeId, punchType } = parsedOverride.data;
    const reason = parsedOverride.data.reason ?? "kiosk_override";
    const supervisor = await storage.getUserByPin(supervisorPin);
    if (!supervisor) {
      return kioskError(res, 403, "invalid_pin", "We didn't recognize that supervisor PIN.");
    }
    if (supervisor.role !== "admin" && supervisor.role !== "manager") {
      return kioskError(res, 403, "not_authorized", "Only managers or admins can override.");
    }
    const target = await storage.getUser(targetEmployeeId);
    if (!target) return kioskError(res, 404, "employee_not_found", "We couldn't find that employee.");

    const override = await storage.recordBiometricSupervisorOverride({
      supervisorUserId: supervisor.id,
      employeeUserId: target.id,
      kioskDeviceId: device.id,
      punchType,
      reason,
    });
    await writeAuditLog({
      actorUserId: supervisor.id,
      targetType: "biometric_attempt",
      targetId: override.id,
      action: "biometric.supervisor_override",
      newValue: { targetUserId: target.id, kioskDeviceId: device.id, reason },
      context: getAuditContext(req),
    });

    const deptName = await getDepartmentName(target.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(target.id);
    const kioskLastRecord = lastRecord
      ? {
          id: lastRecord.id,
          type: lastRecord.clockOut ? "clock_out" : lastRecord.clockIn ? "clock_in" : null,
          timestamp: lastRecord.clockOut || lastRecord.clockIn,
        }
      : null;
    const allowedPunchSources = await getKioskAllowedSourcesForUser(target);
    res.json({
      ok: true,
      overrideId: override.id,
      employee: sanitizeUserForKiosk(target, deptName, allowedPunchSources),
      lastRecord: kioskLastRecord,
    });
  }));

  return httpServer;
}
