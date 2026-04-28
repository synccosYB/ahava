import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { db } from "./db";
import { payrollExports as payrollExportsTable, payrollBatchRecords as payrollBatchRecordsTable } from "@shared/schema";
import { requireAuth, requirePasswordChanged } from "./middleware/auth";
import { requirePermission } from "./middleware/rbac";
import { insertDepartmentSchema, insertTimeOffRequestSchema, insertCompanySchema, insertLocationSchema, insertLocationAddressSchema, insertEmploymentProfileSchema, insertPtoPolicySchema, insertEmployeePtoSettingsSchema, insertAttendanceExceptionSchema, insertPolicySchema, insertPolicyAssignmentSchema, insertKioskDeviceSchema, insertRoleSchema, timeOffRequests, attendanceExceptions, auditLogs, punchLogs, insertPerformanceReviewCycleSchema, insertOnboardingTemplateSchema, insertOnboardingTemplateTaskSchema, insertOffboardingTemplateSchema, insertOffboardingTemplateTaskSchema } from "@shared/schema";
import type { User, PunchLog, InsertPunchLog, TimeOffRequest, Department, Location, AttendanceException } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, inArray } from "drizzle-orm";
import { writeAuditLog, getAuditContext } from "./services/audit";
import { getEffectivePolicy, getDefaultRulesForType, DEFAULT_ATTENDANCE_RULES, DEFAULT_PTO_RULES, DEFAULT_PAYROLL_RULES } from "./policyEngine";
import { buildEmployeeTimesheet, computeAttendanceTotals } from "./timesheetService";
import { runAlertDetection } from "./services/alerts";
import { enforceClockIn, enforceClockOut, enforcePtoAdvanceNotice, enforcePtoBlackoutDates, runAutoClockOut, createPolicyAlerts, createPolicyAlert, evaluateDayOfWeekBonuses, evaluateEarlyArrivalBonuses, roundTime } from "./services/policyEnforcement";
import { materializeOnboardingChecklist, autoCompleteDocumentTask } from "./services/onboarding";
import { materializeOffboardingChecklist, evaluateDeactivationGate } from "./services/offboarding";
import { attachPolicyContext, getPolicyRules, getResolvedPolicy } from "./middleware/policyContext";
import { runWorkflowsForTrigger } from "./workflowEngine";
import { requestCache } from "./lib/requestCache";
import { appCache } from "./lib/cache";
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

function invalidateUserCache() {
  appCache.invalidatePrefix("rc:");
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
      }
    }
  } catch (error) {
    console.error("Error checking post-export modification:", error);
  }
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

function sanitizeUserForKiosk(user: User, departmentName?: string) {
  return {
    id: user.id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    department: departmentName || "Unassigned",
    employeeId: user.id,
  };
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
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const PASSWORD_CHANGE_EXEMPT_PATHS = ["/api/auth", "/api/users/change-password"];
  app.use((req, res, next) => {
    if (PASSWORD_CHANGE_EXEMPT_PATHS.some(p => req.path.startsWith(p))) {
      return next();
    }
    requirePasswordChanged(req, res, next);
  });
  app.get("/api/users", requireAuth, requireRole("admin"), requirePermission("users.view"), requestCache({ scope: "user" }), async (req, res) => {
    const users = await storage.getAllUsers();
    // Attach role-rule provenance: which active rule (if any) matches this
    // user. UI uses this to show "Set by rule" only when an actual rule
    // matches, instead of inferring from the absence of a manual override.
    const [activeRules, allProfiles] = await Promise.all([
      storage.getActiveRoleAssignmentRules(),
      storage.getAllEmploymentProfiles(),
    ]);
    const profileByUser = new Map(allProfiles.map(p => [p.userId, p]));
    const { evaluateRoleForUser } = await import("./services/roleAssignment");
    const enriched = users.map(u => {
      const match = evaluateRoleForUser(u, profileByUser.get(u.id), activeRules);
      return {
        ...u,
        assignedByRule: match ? { id: match.rule.id, name: match.rule.name } : null,
      };
    });
    res.json(hideSuperAdmin(enriched, isSuperAdmin(req)));
  });

  app.patch("/api/users/:id/role", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    if (req.params.id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
    }
    const id = req.params.id as string;
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

  app.post("/api/users/:id/clear-role-override", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    if (req.params.id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const id = req.params.id as string;
    const existing = await storage.getUser(id);
    if (!existing) return res.status(404).json({ message: "User not found" });
    const previouslyOverridden = existing.roleManuallyOverriddenAt;
    await storage.updateUser(id, { roleManuallyOverriddenAt: null });
    const actor = (req as any).authUser as User;
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
    const result = await applyRoleForUser(id, { actorUserId: actor.id, reason: "manual override cleared", force: true });
    const user = await storage.getUser(id);
    invalidateUserCache();
    res.json({ user, result });
  });

  const createUserSchema = z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.enum(["employee", "manager", "admin"]).default("employee"),
    companyId: z.string().optional().nullable(),
    locationId: z.string().optional().nullable(),
    departmentId: z.string().optional().nullable(),
    employmentType: z.string().optional(),
    hireDate: z.string().optional(),
    payType: z.string().optional(),
    hourlyRate: z.number().optional(),
    weeklySalary: z.number().optional(),
    onboardingTemplateId: z.string().optional().nullable(),
    skipOnboarding: z.boolean().optional(),
  });

  app.post("/api/users", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid user data", errors: parsed.error.flatten() });
    }

    const existing = await storage.getUserByEmail(parsed.data.email);
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    if (parsed.data.companyId) {
      if (parsed.data.locationId) {
        const loc = await storage.getLocation(parsed.data.locationId);
        if (!loc || loc.companyId !== parsed.data.companyId) {
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

    if (parsed.data.employmentType || parsed.data.payType || parsed.data.hourlyRate || parsed.data.weeklySalary || parsed.data.hireDate) {
      await storage.createEmploymentProfile({
        userId: newUser.id,
        employmentType: parsed.data.employmentType || "full_time",
        payType: parsed.data.payType || "hourly",
        hourlyRate: parsed.data.hourlyRate || null,
        weeklySalary: parsed.data.weeklySalary || null,
        hireDate: parsed.data.hireDate || null,
        overtimeEligible: false,
        holidayPayEnabled: false,
        voluntaryPayEnabled: false,
      });
    }

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
  });

  const bulkAssignDivisionSchema = z.object({
    userIds: z.array(z.string().min(1)).min(1).max(500),
    companyId: z.string().min(1),
    keepCompatible: z.boolean().optional().default(false),
  });

  app.post("/api/users/bulk-assign-division", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = bulkAssignDivisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
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
          if (loc && loc.companyId === companyId) nextLocationId = existing.locationId;
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

  app.patch("/api/users/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    if (req.params.id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
    }
    const existing = await storage.getUser(req.params.id);
    if (!existing) return res.status(404).json({ message: "User not found" });

    const next = {
      companyId: parsed.data.companyId !== undefined ? parsed.data.companyId : existing.companyId,
      locationId: parsed.data.locationId !== undefined ? parsed.data.locationId : existing.locationId,
      departmentId: parsed.data.departmentId !== undefined ? parsed.data.departmentId : existing.departmentId,
    };

    if (next.companyId) {
      if (next.locationId) {
        const loc = await storage.getLocation(next.locationId);
        if (!loc || loc.companyId !== next.companyId) {
          return res.status(400).json({ message: "Location does not belong to the selected company" });
        }
      }
      if (next.departmentId) {
        const dept = await storage.getDepartment(next.departmentId);
        if (!dept || (dept.companyId && dept.companyId !== next.companyId)) {
          return res.status(400).json({ message: "Department does not belong to the selected company" });
        }
      }
    } else {
      if (next.locationId || next.departmentId) {
        return res.status(400).json({ message: "Cannot assign location or department without a company" });
      }
    }

    const updated = await storage.updateUser(req.params.id, {
      companyId: next.companyId,
      locationId: next.locationId,
      departmentId: next.departmentId,
    });
    if (!updated) return res.status(404).json({ message: "User not found" });

    try {
      const actor = (req as any).authUser as User | undefined;
      await applyRoleForUser(req.params.id, {
        actorUserId: actor?.id || "system",
        reason: "user.update",
      });
    } catch (err) {
      console.error("applyRoleForUser failed on user update:", err);
    }

    invalidateUserCache();
    const refreshed = await storage.getUser(req.params.id);
    const { password: _p, passwordHash: _ph, ...safe } = refreshed || updated;
    res.json(safe);
  });

  app.post("/api/users/:id/reset-password", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    if (req.params.id === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = await storage.getUser(req.params.id);
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

  app.get("/api/users/:id/documents", requireAuth, requireRole("admin"), requirePermission("users.view"), async (req, res) => {
    const docs = await storage.getDocumentsByEmployee(req.params.id);
    res.json(docs);
  });

  app.post("/api/users/:id/documents", requireAuth, requireRole("admin"), requirePermission("users.edit"), documentUpload.single("file"), async (req, res) => {
    const employee = await storage.getUser(req.params.id);
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
        employeeId: req.params.id,
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
        await resolveMissingDocumentAlertsFor(req.params.id, documentType, adminUser.id);
      } catch (err) {
        console.error("Failed to resolve missing-document alerts after upload:", err);
      }
      try {
        await autoCompleteDocumentTask(req.params.id, documentType, doc.id, adminUser.id);
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
      res.status(500).json({ message: "Failed to save document" });
    }
  });

  app.get("/api/documents/:id/download", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
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
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.patch("/api/documents/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const { status } = req.body;
    if (!status || !["uploaded", "reviewed", "missing"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    try {
      const adminUser = (req as any).authUser as User;
      const doc = await storage.updateDocument(req.params.id, {
        status,
        ...(status === "reviewed" ? { reviewedBy: adminUser.id, reviewedAt: new Date() } : {}),
      });
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (error) {
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  app.delete("/api/documents/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      try {
        await deleteStoredDocument(doc.filePath);
      } catch (err) {
        console.error("Failed to delete document file:", err);
      }

      await storage.deleteDocument(doc.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete document" });
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
    const targetId = req.params.id;
    const requester = (req as unknown as { authUser: User }).authUser;
    let allowed = requester.id === targetId || requester.role === "admin";
    if (!allowed && requester.role === "manager") {
      const target = await storage.getUser(targetId);
      if (target?.departmentId) {
        const managedDepts = await storage.getDepartmentsForManager(requester.id);
        allowed = managedDepts.some((d) => d.id === target.departmentId);
      }
    }
    if (!allowed) return res.status(403).json({ message: "Forbidden" });
    try {
      const certs = await storage.getCertificationsByEmployee(targetId);
      res.json(certs);
    } catch (err) {
      console.error("Failed to fetch certifications:", err);
      res.status(500).json({ message: "Failed to fetch certifications" });
    }
  });

  app.get("/api/certifications", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const certs = await storage.getAllCertifications({ status });
      res.json(certs);
    } catch (err) {
      console.error("Failed to fetch certifications:", err);
      res.status(500).json({ message: "Failed to fetch certifications" });
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
      res.status(500).json({ message: "Failed to create certification" });
    }
  }

  app.post("/api/certifications", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    const employeeId = (req.body || {}).employeeId;
    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });
    return createCertificationHandler(req, res, employeeId);
  });

  app.patch("/api/certifications/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    const parsed = certificationBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid certification data", errors: parsed.error.flatten() });
    }
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getCertification(req.params.id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      const expirationChanged = parsed.data.expirationDate !== undefined && parsed.data.expirationDate !== existing.expirationDate;
      const updated = await storage.updateCertification(req.params.id, parsed.data);
      const ctx = getAuditContext(req);
      const action = parsed.data.status === "archived" ? "certification.archive" : "certification.update";
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "certification",
        targetId: req.params.id,
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
          await resolveCertificationAlertsFor(req.params.id, adminUser.id);
        }
      } catch (syncErr) {
        console.warn("certification PATCH alert sync failed:", syncErr);
      }
      res.json(updated);
    } catch (err) {
      console.error("Failed to update certification:", err);
      res.status(500).json({ message: "Failed to update certification" });
    }
  });

  app.post(
    "/api/certifications/:id/document",
    requireAuth,
    requireRole("admin"),
    requirePermission("users.edit"),
    documentUpload.single("file"),
    async (req, res) => {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });
      const adminUser = (req as unknown as { authUser: User }).authUser;
      const cert = await storage.getCertification(req.params.id);
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
        const updated = await storage.updateCertification(req.params.id, { documentId: doc.id });
        const ctx = getAuditContext(req);
        await writeAuditLog({
          actorUserId: adminUser.id,
          targetType: "certification",
          targetId: req.params.id,
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
        res.status(500).json({ message: "Failed to attach document" });
      }
    },
  );

  app.delete("/api/certifications/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getCertification(req.params.id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      try {
        const { resolveCertificationAlertsFor } = await import("./services/lifecycleAlerts");
        await resolveCertificationAlertsFor(req.params.id, adminUser.id);
      } catch (resErr) {
        console.warn("Failed to resolve cert alerts before delete:", resErr);
      }
      await storage.deleteCertification(req.params.id);
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "certification",
        targetId: req.params.id,
        action: "certification.delete",
        oldValue: existing,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete certification:", err);
      res.status(500).json({ message: "Failed to delete certification" });
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

  app.get("/api/required-documents", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const documentType = typeof req.query.documentType === "string" ? req.query.documentType : undefined;
      const isActiveRaw = req.query.isActive;
      const isActive = isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined;
      const scopeType = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
      const rules = await storage.getAllRequiredDocumentRules({ documentType, isActive, scopeType });
      res.json(rules);
    } catch (err) {
      console.error("Failed to fetch required document rules:", err);
      res.status(500).json({ message: "Failed to fetch required document rules" });
    }
  });

  app.post("/api/required-documents", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to create required document rule" });
    }
  });

  app.patch("/api/required-documents/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    const parsed = requiredDocBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rule data", errors: parsed.error.flatten() });
    }
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getRequiredDocumentRule(req.params.id);
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
      const updated = await storage.updateRequiredDocumentRule(req.params.id, parsed.data);
      const ctx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "required_document_rule",
        targetId: req.params.id,
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
      res.status(500).json({ message: "Failed to update required document rule" });
    }
  });

  app.delete("/api/required-documents/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    const adminUser = req.authUser as User;
    try {
      const existing = await storage.getRequiredDocumentRule(req.params.id);
      if (!existing) return res.status(404).json({ message: "Required document rule not found" });
      await storage.deleteRequiredDocumentRule(req.params.id);
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
        targetId: req.params.id,
        action: "required_document_rule.delete",
        oldValue: existing,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete required document rule:", err);
      res.status(500).json({ message: "Failed to delete required document rule" });
    }
  });

  app.post("/api/required-documents/evaluate-now", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to evaluate missing documents" });
    }
  });

  app.post("/api/users/:id/certifications", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req: any, res) => {
    return createCertificationHandler(req, res, req.params.id);
  });

  app.get("/api/payroll-documents/my", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const docs = await storage.getPayrollDocumentsByEmployee(userId);
      const enriched = await Promise.all(docs.map(async (doc) => {
        const uploader = doc.uploadedBy ? await storage.getUser(doc.uploadedBy) : null;
        return { ...doc, uploaderName: uploader ? `${uploader.firstName} ${uploader.lastName}` : "System" };
      }));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payroll documents" });
    }
  });

  app.get("/api/payroll-documents", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const docs = await storage.getAllPayrollDocuments();
      const enriched = await Promise.all(docs.map(async (doc) => {
        const employee = await storage.getUser(doc.employeeId);
        const uploader = doc.uploadedBy ? await storage.getUser(doc.uploadedBy) : null;
        return {
          ...doc,
          employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          uploaderName: uploader ? `${uploader.firstName} ${uploader.lastName}` : "System",
        };
      }));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payroll documents" });
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

  app.post("/api/payroll-documents", requireAuth, requireRole("admin"), async (req: any, res) => {
    const parsed = payrollDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
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
      res.status(500).json({ message: "Failed to create payroll document" });
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
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
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
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/payroll-documents/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const doc = await storage.getPayrollDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      await storage.deletePayrollDocument(doc.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete payroll document" });
    }
  });

  app.get("/api/pto-balances/all", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const departments = await storage.getAllDepartments();
      const deptMap = new Map(departments.map(d => [d.id, d.name]));
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const deptManagerMap = new Map<string, string[]>();
      await Promise.all(departments.map(async (dept) => {
        const managers = await storage.getDepartmentManagers(dept.id);
        const names = managers.map(m => {
          const mu = userMap.get(m.userId);
          return mu ? `${mu.firstName || ""} ${mu.lastName || ""}`.trim() : "";
        }).filter(n => n);
        deptManagerMap.set(dept.id, names);
      }));
      const currentYear = new Date().getFullYear();
      const balances = await Promise.all(allUsers.filter(u => u.id !== "admin-dev-001").map(async (user) => {
        const ptoSettings = await storage.getEmployeePtoSettings(user.id);
        const policy = ptoSettings?.ptoPolicyId ? await storage.getPtoPolicy(ptoSettings.ptoPolicyId) : await storage.getDefaultPtoPolicy();
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
        const managerNames = user.departmentId ? (deptManagerMap.get(user.departmentId) || []) : [];
        return {
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          departmentId: user.departmentId,
          departmentName: user.departmentId ? deptMap.get(user.departmentId) || "Unassigned" : "Unassigned",
          profileImageUrl: user.profileImageUrl,
          managerNames,
          vacation: { total: totalVacation, used: usedVacation, pending: pendingVacation },
          sick: { total: totalSick, used: usedSick, pending: pendingSick },
          personal: { total: totalPersonal, used: usedPersonal, pending: pendingPersonal },
        };
      }));
      res.json(balances);
    } catch (error) {
      console.error("Error fetching PTO balances:", error);
      res.status(500).json({ message: "Failed to fetch PTO balances" });
    }
  });

  app.get("/api/companies", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    if (user.role === "admin") {
      const allCompanies = await storage.getAllCompanies();
      return res.json(allCompanies);
    }
    if (user.companyId) {
      const company = await storage.getCompany(user.companyId);
      return res.json(company ? [company] : []);
    }
    return res.json([]);
  });

  app.get("/api/companies/:id", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const company = await storage.getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    if (user.role !== "admin" && user.companyId !== company.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(company);
  });

  app.post("/api/companies", requireAuth, requireRole("admin"), requirePermission("company.create"), async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.createCompany(parsed.data);
    res.status(201).json(company);
  });

  app.patch("/api/companies/:id", requireAuth, requireRole("admin"), requirePermission("company.edit"), async (req, res) => {
    const parsed = insertCompanySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.updateCompany(req.params.id, parsed.data);
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json(company);
  });

  app.delete("/api/companies/:id", requireAuth, requireRole("admin"), requirePermission("company.edit"), async (req, res) => {
    const company = await storage.getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    await storage.deleteCompany(req.params.id);
    res.status(204).send();
  });

  app.get("/api/locations", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const companyId = req.query.companyId as string | undefined;

    if (user.role === "admin") {
      if (companyId) {
        return res.json(await storage.getLocationsByCompany(companyId));
      }
      return res.json(await storage.getAllLocations());
    }
    if (user.companyId) {
      const locs = await storage.getLocationsByCompany(user.companyId);
      if (user.locationId) {
        return res.json(locs.filter(l => l.id === user.locationId));
      }
      return res.json(locs);
    }
    return res.json([]);
  });

  app.get("/api/locations/:id", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const location = await storage.getLocation(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    if (user.role !== "admin" && user.companyId !== location.companyId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role !== "admin" && user.locationId && user.locationId !== location.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(location);
  });

  app.post("/api/locations", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const parsed = insertLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const location = await storage.createLocation(parsed.data);
    res.status(201).json(location);
  });

  app.patch("/api/locations/:id", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const parsed = insertLocationSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const location = await storage.updateLocation(req.params.id, parsed.data);
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.delete("/api/locations/:id", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const location = await storage.getLocation(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    await storage.deleteLocation(req.params.id);
    res.status(204).send();
  });

  app.get("/api/locations/:locationId/addresses", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const location = await storage.getLocation(req.params.locationId);
    if (!location) return res.status(404).json({ message: "Location not found" });
    const addresses = await storage.getLocationAddresses(req.params.locationId);
    res.json(addresses);
  });

  app.post("/api/locations/:locationId/addresses", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const location = await storage.getLocation(req.params.locationId);
    if (!location) return res.status(404).json({ message: "Location not found" });
    const parsed = insertLocationAddressSchema.safeParse({ ...req.body, locationId: req.params.locationId });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid address data", errors: parsed.error.flatten() });
    }
    const address = await storage.createLocationAddress(parsed.data);
    res.status(201).json(address);
  });

  app.patch("/api/locations/:locationId/addresses/:id", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const existing = await storage.getLocationAddress(req.params.id);
    if (!existing || existing.locationId !== req.params.locationId) {
      return res.status(404).json({ message: "Address not found" });
    }
    const parsed = insertLocationAddressSchema.omit({ locationId: true }).partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid address data", errors: parsed.error.flatten() });
    }
    const address = await storage.updateLocationAddress(req.params.id, parsed.data);
    res.json(address);
  });

  app.delete("/api/locations/:locationId/addresses/:id", requireAuth, requireRole("admin"), requirePermission("locations.manage"), async (req, res) => {
    const existing = await storage.getLocationAddress(req.params.id);
    if (!existing || existing.locationId !== req.params.locationId) {
      return res.status(404).json({ message: "Address not found" });
    }
    await storage.deleteLocationAddress(req.params.id);
    res.status(204).send();
  });

  async function enrichDepartmentsWithManagers(depts: Department[]) {
    return Promise.all(depts.map(async (dept) => {
      const managers = await storage.getDepartmentManagers(dept.id);
      return { ...dept, managerIds: managers.map(m => m.userId) };
    }));
  }

  app.get("/api/departments", requireAuth, requirePermission("departments.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const companyId = req.query.companyId as string | undefined;
    const locationId = req.query.locationId as string | undefined;

    let depts: Department[];
    if (user.role === "admin") {
      if (locationId) {
        depts = await storage.getDepartmentsByLocation(locationId);
      } else if (companyId) {
        depts = await storage.getDepartmentsByCompany(companyId);
      } else {
        depts = await storage.getAllDepartments();
      }
    } else if (user.departmentId && !user.companyId && !user.locationId) {
      const dept = await storage.getDepartment(user.departmentId);
      depts = dept ? [dept] : [];
    } else if (!user.companyId) {
      depts = [];
    } else {
      depts = await storage.getDepartmentsByCompany(user.companyId);
      if (user.locationId) {
        depts = depts.filter(d => d.locationId === user.locationId);
      }
    }

    res.json(await enrichDepartmentsWithManagers(depts));
  });

  const managerIdsSchema = z.array(z.string()).optional().default([]);

  app.post("/api/departments", requireAuth, requireRole("admin"), requirePermission("departments.create"), async (req, res) => {
    const { managerIds: rawManagerIds, ...deptData } = req.body;
    const parsed = insertDepartmentSchema.safeParse(deptData);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    const mgrParsed = managerIdsSchema.safeParse(rawManagerIds);
    if (!mgrParsed.success) {
      return res.status(400).json({ message: "Invalid managerIds, expected an array of strings" });
    }
    const uniqueManagerIds = [...new Set(mgrParsed.data)];
    if (parsed.data.locationId && parsed.data.companyId) {
      const location = await storage.getLocation(parsed.data.locationId);
      if (!location || location.companyId !== parsed.data.companyId) {
        return res.status(400).json({ message: "Location does not belong to the specified company" });
      }
    }
    const dept = await storage.createDepartment(parsed.data);
    if (uniqueManagerIds.length > 0) {
      await storage.setDepartmentManagers(dept.id, uniqueManagerIds);
    }
    const managers = await storage.getDepartmentManagers(dept.id);
    res.status(201).json({ ...dept, managerIds: managers.map(m => m.userId) });
  });

  app.patch("/api/departments/:id", requireAuth, requireRole("admin"), requirePermission("departments.edit"), async (req, res) => {
    const { managerIds: rawManagerIds, ...deptData } = req.body;
    const parsed = insertDepartmentSchema.partial().safeParse(deptData);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    const dept = await storage.updateDepartment(req.params.id, parsed.data);
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
  });

  app.delete("/api/departments/:id", requireAuth, requireRole("admin"), requirePermission("departments.edit"), async (req, res) => {
    await storage.deleteDepartment(req.params.id);
    res.status(204).send();
  });

  app.get("/api/profile/details", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const userId = authUser.id;

    try {
      const user = await storage.getUser(userId);
      if (!user) return res.sendStatus(404);

      const emp = await storage.getEmploymentProfile(userId);

      const [company, location, department] = await Promise.all([
        user.companyId ? storage.getCompany(user.companyId) : null,
        user.locationId ? storage.getLocation(user.locationId) : null,
        user.departmentId ? storage.getDepartment(user.departmentId) : null,
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
        locationName: location?.name ?? "—",
        departmentName: department?.name ?? "—",

        employmentType: emp?.employmentType ?? "—",
        payType: emp?.payType ?? "—",
        hireDate: emp?.hireDate ?? null,
        overtimeEligible: emp?.overtimeEligible ?? false,

        vacationBalance: vacationBalance ? vacationBalance.totalDays - vacationBalance.usedDays : 0,
        sickBalance: sickBalance ? sickBalance.totalDays - sickBalance.usedDays : 0,
        personalBalance: personalBalance ? personalBalance.totalDays - personalBalance.usedDays : 0,
      });
    } catch (err) {
      console.error("[GET /api/profile/details]", err);
      return res.status(500).json({ message: "Failed to load profile details" });
    }
  });

  app.get("/api/employment-profiles/:userId", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const targetUserId = req.params.userId;

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

  app.post("/api/employment-profiles", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const existing = await storage.getEmploymentProfile(parsed.data.userId);
    if (existing) {
      return res.status(409).json({ message: "Employment profile already exists for this user" });
    }
    const profile = await storage.createEmploymentProfile(parsed.data);
    res.status(201).json(profile);
  });

  app.patch("/api/employment-profiles/:userId", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const before = await storage.getEmploymentProfile(req.params.userId);
    const profile = await storage.updateEmploymentProfile(req.params.userId, parsed.data);
    if (!profile) return res.status(404).json({ message: "Employment profile not found" });

    try {
      const actor = (req as any).authUser as User | undefined;
      await applyRoleForUser(req.params.userId, {
        actorUserId: actor?.id || "system",
        reason: "employment_profile.update",
      });
    } catch (err) {
      console.error("applyRoleForUser failed on profile update:", err);
    }

    invalidateUserCache();

    if (parsed.data.terminationDate && (!before?.terminationDate || before.terminationDate !== parsed.data.terminationDate)) {
      try {
        const employee = await storage.getUser(req.params.userId);
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
    if (user.departmentId) {
      const deptUsers = await storage.getUsersByDepartment(user.departmentId);
      return new Set(deptUsers.filter(u => u.id !== user.id).map(u => u.id));
    }
    return new Set();
  }

  app.get("/api/time-off/pending", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
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
      await Promise.all(allDepartments.map(async (dept) => {
        const managers = await storage.getDepartmentManagers(dept.id);
        const names = managers.map(m => {
          const mu = userMap.get(m.userId);
          return mu ? `${mu.firstName || ""} ${mu.lastName || ""}`.trim() : "Unknown";
        }).filter(n => n && n !== "Unknown");
        deptManagerMap.set(dept.id, names);
      }));
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
      const dept = u?.departmentId ? deptMap.get(u.departmentId) : undefined;
      const loc = u?.locationId ? locMap.get(u.locationId) : undefined;
      return {
        ...base,
        departmentName: dept?.name || "Unassigned",
        locationName: loc?.name || "Unassigned",
        managerNames: dept ? (deptManagerMap.get(dept.id) || []) : [],
      };
    });
    res.json(enriched);
  });

  async function getDepartmentName(departmentId: string | null): Promise<string> {
    if (!departmentId) return "Unassigned";
    const dept = await storage.getDepartment(departmentId);
    return dept?.name || "Unassigned";
  }

  app.post("/api/kiosk/lookup-pin", async (req, res) => {
    const parsed = pinLookupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid PIN is required" });
    }
    const user = await storage.getUserByPin(parsed.data.pin);
    if (!user) {
      return res.status(404).json({ error: "Invalid PIN" });
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    return res.json({ employee: sanitizeUserForKiosk(user, deptName), lastRecord: kioskLastRecord });
  });

  app.get("/api/kiosk/search", async (req, res) => {
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
  });

  app.get("/api/kiosk/employee/:id", async (req, res) => {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "Invalid employee ID" });
    }
    const user = await storage.getUser(id);
    if (!user) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    return res.json({ employee: sanitizeUserForKiosk(user, deptName), lastRecord: kioskLastRecord });
  });

  app.post("/api/kiosk/punch", async (req, res) => {
    const parsed = kioskPunchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid employee ID and type (clock_in/clock_out) are required" });
    }
    const { employeeId, type } = parsed.data;
    const user = await storage.getUser(employeeId);
    if (!user) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const today = new Date().toISOString().split("T")[0];
    const deptName = await getDepartmentName(user.departmentId);

    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const attRules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;

    if (type === "clock_in") {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (lastRecord && lastRecord.clockIn && !lastRecord.clockOut && lastRecord.workDate === today) {
        return res.status(400).json({ error: "Employee is already clocked in" });
      }

      const now = new Date();
      const enforcement = await enforceClockIn(user, now, attRules, attendancePolicy?.policyName);

      if (!enforcement.allowed) {
        return res.status(403).json({ error: enforcement.rejectionMessage });
      }

      const record = await storage.createAttendanceRecord({
        employeeId: user.id,
        workDate: today,
        clockIn: now,
        roundedClockIn: enforcement.roundedTime,
        status: "present",
        source: "kiosk",
        approved: true,
      });

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      const scheduleWarning = await getScheduleWarning(user.id, "clock_in");
      return res.json({
        record: { id: record.id, type: "clock_in", timestamp: record.clockIn },
        employee: sanitizeUserForKiosk(user, deptName),
        ...(scheduleWarning ? { scheduleWarning } : {}),
      });
    } else {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (!lastRecord || !lastRecord.clockIn || lastRecord.clockOut) {
        return res.status(400).json({ error: "Employee is not clocked in" });
      }

      const payrollPolicy = await getEffectivePolicy(user.companyId, user.id, "payroll", user);
      const payrollRules = payrollPolicy?.rules || DEFAULT_PAYROLL_RULES;

      const now = new Date();
      const roundedClockInTime = new Date(lastRecord.roundedClockIn ?? lastRecord.clockIn);
      const breakMinutes = lastRecord.breakMinutes || 0;

      const enforcement = enforceClockOut(roundedClockInTime, now, breakMinutes, attRules, payrollRules, user, attendancePolicy?.policyName);

      const updated = await storage.updatePunchLog(lastRecord.id, {
        clockOut: now,
        roundedClockOut: enforcement.roundedTime,
        hoursWorked: enforcement.hoursWorked,
        status: enforcement.status,
      });

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await checkPostExportModification(lastRecord.id, user.id);
      const scheduleWarning = await getScheduleWarning(user.id, "clock_out");
      return res.json({
        record: { id: updated?.id, type: "clock_out", timestamp: updated?.clockOut },
        employee: sanitizeUserForKiosk(user, deptName),
        ...(scheduleWarning ? { scheduleWarning } : {}),
      });
    }
  });

  app.get("/api/attendance/status", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const userRole = req.authUser.role;
      const current = await storage.getCurrentAttendance(userId);
      const todayHours = await storage.getTodayHours(userId);
      const weekHours = await storage.getWeekHours(userId);

      const response: any = {
        isClockedIn: !!current,
        currentRecord: current ? punchLogToApiResponse(current) : null,
        todayHours,
        weekHours,
      };

      if (userRole === "admin" || userRole === "manager") {
        response.ptoBalance = await storage.computeTimeOffBalance(userId);
      }

      res.json(response);
    } catch (error) {
      console.error("Error fetching status:", error);
      res.status(500).json({ message: "Failed to fetch attendance status" });
    }
  });

  app.post("/api/attendance/clock-in", requireAuth, attachPolicyContext("attendance"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const current = await storage.getCurrentAttendance(userId);
      if (current) {
        return res.status(400).json({ message: "Already clocked in" });
      }

      const source = req.body?.source || "web";
      const rules = getPolicyRules(req, "attendance");
      const allowedSources: string[] = rules.allowedPunchSources || ["web", "kiosk", "mobile"];
      if (!allowedSources.includes(source)) {
        return res.status(403).json({ message: `Punch source '${source}' is not allowed by attendance policy` });
      }

      const now = new Date();
      const attPolicy = getResolvedPolicy(req, "attendance");
      const enforcement = await enforceClockIn(user, now, rules, attPolicy?.policyName);

      if (!enforcement.allowed) {
        return res.status(403).json({ message: enforcement.rejectionMessage });
      }

      const record = await storage.clockIn(userId, source, enforcement.roundedTime);

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      const scheduleWarning = await getScheduleWarning(userId, "clock_in");
      res.json({ ...punchLogToApiResponse(record), ...(scheduleWarning ? { scheduleWarning } : {}) });
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(500).json({ message: "Failed to clock in" });
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

      const now = new Date();
      const roundedClockInTime = new Date(current.roundedClockIn ?? current.clockIn);
      const breakMinutes = current.breakMinutes || 0;

      const attPolicy = getResolvedPolicy(req, "attendance");
      const enforcement = enforceClockOut(roundedClockInTime, now, breakMinutes, rules, payrollRules, user, attPolicy?.policyName);

      const record = await storage.updatePunchLog(current.id, {
        clockOut: now,
        roundedClockOut: enforcement.roundedTime,
        hoursWorked: enforcement.hoursWorked,
        status: enforcement.status,
      });

      if (!record) {
        return res.status(400).json({ message: "Failed to clock out" });
      }

      if (enforcement.alerts.length > 0) {
        await createPolicyAlerts(enforcement.alerts);
      }

      await checkPostExportModification(record.id, userId);
      const scheduleWarning = await getScheduleWarning(userId, "clock_out");
      res.json({ ...punchLogToApiResponse(record), ...(scheduleWarning ? { scheduleWarning } : {}) });
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(500).json({ message: "Failed to clock out" });
    }
  });

  const scheduleEntrySchema = z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isActive: z.boolean().default(true),
  });

  app.get("/api/employees/:employeeId/schedules", requireAuth, requireRole("admin", "manager"), async (req: any, res) => {
    try {
      const { employeeId } = req.params;
      const schedules = await storage.getEmployeeSchedules(employeeId);
      res.json(schedules);
    } catch (error) {
      console.error("Error fetching employee schedules:", error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.put("/api/employees/:employeeId/schedules", requireAuth, requireRole("admin", "manager"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to save schedules" });
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

      res.json(records.map(r => ({
        ...punchLogToApiResponse(r),
        wasCorrected: correctedIds.has(r.id),
      })));
    } catch (error) {
      console.error("Error fetching records:", error);
      res.status(500).json({ message: "Failed to fetch attendance records" });
    }
  });

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
      res.status(500).json({ message: "Failed to fetch employee timesheet" });
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
      res.status(500).json({ message: "Failed to fetch eligible employees" });
    }
  });

  app.post("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const { exceptionDate, exceptionTime, type, reason, punchLogId } = req.body;

      if (!exceptionDate || !type || !reason) {
        return res.status(400).json({ message: "Date, type, and reason are required" });
      }

      const validTypes = ["missing_punch", "time_correction", "forgotten_clock_in", "forgotten_clock_out"];
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
          if (!hasUnusedReopen) {
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
      res.status(500).json({ message: "Failed to create attendance exception" });
    }
  });

  app.patch("/api/attendance/exceptions/:id", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = req.params.id as string;
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

      const validTypes = ["missing_punch", "time_correction", "forgotten_clock_in", "forgotten_clock_out"];
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

      const updated = await storage.updateAttendanceException(exceptionId, updateData);

      res.json(updated);
    } catch (error) {
      console.error("Error updating attendance exception:", error);
      res.status(500).json({ message: "Failed to update attendance exception" });
    }
  });

  app.post("/api/attendance/exceptions/:id/cancel", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = req.params.id as string;

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
      });

      res.json(updated);
    } catch (error) {
      console.error("Error cancelling attendance exception:", error);
      res.status(500).json({ message: "Failed to cancel attendance exception" });
    }
  });

  app.post("/api/attendance/exceptions/:id/reopen-request", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const exceptionId = req.params.id as string;
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
      res.status(500).json({ message: "Failed to submit reopen request" });
    }
  });

  app.post("/api/attendance/exceptions/:id/reopen-decide", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const reviewer = req.authUser as User;
      const exceptionId = req.params.id as string;
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
        }).where(eq(attendanceExceptions.id, exceptionId)).returning();

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
      res.status(500).json({ message: "Failed to decide reopen request" });
    }
  });

  app.get("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;

      if (user.role === "admin" || user.role === "manager") {
        const all = await storage.getAllAttendanceExceptions();
        const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
        const userMap = new Map(allUsers.map(u => [u.id, u]));
        const employeeIds = Array.from(new Set(all.map(e => e.employeeId)));
        const payPeriodTypeByEmployee = await buildPayPeriodTypeMap(employeeIds, userMap);
        const counts = await storage.getCorrectionRequestCountsBulk(employeeIds, {
          payPeriodTypeByEmployee,
        });
        const allDepartments = await storage.getAllDepartments();
        const deptMap = new Map(allDepartments.map(d => [d.id, d]));
        const allLocations = await storage.getAllLocations();
        const locMap = new Map(allLocations.map(l => [l.id, l]));
        const enriched = all.map(e => {
          const summary = counts.get(e.employeeId) || emptyCorrectionCountSummary();
          const u = userMap.get(e.employeeId);
          const dept = u?.departmentId ? deptMap.get(u.departmentId) : undefined;
          const loc = u?.locationId ? locMap.get(u.locationId) : undefined;
          return {
            ...e,
            employeeName: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown",
            departmentName: dept?.name || null,
            locationName: loc?.name || null,
            correctionCounts: summary,
            correctionCount90d: summary,
          };
        });
        return res.json(enriched);
      }

      const exceptions = await storage.getAttendanceExceptionsByEmployee(userId);
      res.json(exceptions);
    } catch (error) {
      console.error("Error fetching attendance exceptions:", error);
      res.status(500).json({ message: "Failed to fetch attendance exceptions" });
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
      res.status(500).json({ message: "Failed to fetch correction counts" });
    }
  });

  app.get(
    "/api/attendance/exceptions/correction-counts/:employeeId",
    requireAuth,
    requireRole("manager", "admin"),
    async (req: any, res) => {
      try {
        const reviewer = req.authUser as User;
        const employeeId = req.params.employeeId as string;
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
        res.status(500).json({ message: "Failed to fetch correction counts" });
      }
    }
  );

  app.get("/api/attendance/exceptions/pending", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
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
        await Promise.all(allDepartments.map(async (dept) => {
          const managers = await storage.getDepartmentManagers(dept.id);
          const names = managers.map(m => {
            const mu = userMap.get(m.userId);
            return mu ? `${mu.firstName || ""} ${mu.lastName || ""}`.trim() : "Unknown";
          }).filter(n => n && n !== "Unknown");
          deptManagerMap.set(dept.id, names);
        }));
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
        const dept = u?.departmentId ? deptMap.get(u.departmentId) : undefined;
        const loc = u?.locationId ? locMap.get(u.locationId) : undefined;
        return {
          ...base,
          departmentName: dept?.name || "Unassigned",
          locationName: loc?.name || "Unassigned",
          managerNames: dept ? (deptManagerMap.get(dept.id) || []) : [],
        };
      });
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching pending exceptions:", error);
      res.status(500).json({ message: "Failed to fetch pending exceptions" });
    }
  });

  app.get("/api/attendance/exceptions/reopen-pending", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to fetch reopen requests" });
    }
  });

  app.get("/api/attendance/exceptions/recent-decided", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
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
      const enriched = decided.map(e => {
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
      console.error("Error fetching recent decided exceptions:", error);
      res.status(500).json({ message: "Failed to fetch recent decided exceptions" });
    }
  });

  const exceptionReviewSchema = z.object({
    action: z.enum(["approve", "deny"]),
    reviewNotes: z.string().optional(),
    correctedTime: z.string().optional(),
    correctedClockIn: z.string().optional(),
    correctedClockOut: z.string().optional(),
  });

  app.post("/api/attendance/exceptions/:id/resolve", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const reviewer = req.authUser as User;
      const exceptionId = req.params.id as string;
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
          }).where(eq(attendanceExceptions.id, exceptionId)).returning();

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

      const updated = await db.transaction(async (tx) => {
        let punchLog: PunchLog | undefined | null = null;

        if (exception.type === "forgotten_clock_in" || exception.type === "missing_punch") {
          const [created] = await tx.insert(punchLogs).values({
            employeeId: exception.employeeId,
            workDate: exception.exceptionDate,
            clockIn: correctedTimestamp || new Date(),
            status: "present",
            source: "exception",
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
          if (latestRecord && latestRecord.clockIn && !latestRecord.clockOut) {
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
            }).where(eq(punchLogs.id, latestRecord.id)).returning();
            punchLog = updated;
          }
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
        }

        const [result] = await tx.update(attendanceExceptions).set({
          status: "approved",
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || null,
          punchLogId: punchLog?.id || null,
        }).where(eq(attendanceExceptions.id, exceptionId)).returning();

        await writeAuditLog({
          actorUserId: reviewer.id,
          targetType: "attendance_exception",
          targetId: exceptionId,
          action: "exception.approved",
          oldValue: { status: "pending" },
          newValue: { status: "approved", punchLogId: punchLog?.id },
          context: { reviewNotes, exceptionType: exception.type },
          ...auditCtx,
        }, tx);

        return { result, punchLog };
      });

      if (updated.punchLog && (exception.type === "forgotten_clock_out" || exception.type === "time_correction")) {
        await checkPostExportModification(updated.punchLog.id, reviewer.id);
      }

      return res.json(updated.result);
    } catch (error) {
      console.error("Error resolving attendance exception:", error);
      res.status(500).json({ message: "Failed to resolve attendance exception" });
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
      if (computedHours > maxConsecutiveHours) {
        return res.status(400).json({
          message: `Request exceeds the maximum consecutive hours allowed (${maxConsecutiveHours}).`,
        });
      }

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

      const exceedsBalance = availableBalance !== null && computedHours > availableBalance;

      const request = await storage.createTimeOffRequest({
        ...parsed,
        status: "pending",
        hoursRequested: computedHours,
        exceedsBalance,
        balanceAtSubmission: availableBalance ?? null,
      });

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
      res.status(500).json({ message: "Failed to create time off request" });
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
      res.status(500).json({ message: "Failed to create cash-out request" });
    }
  });

  app.put("/api/time-off/:id", requireAuth, attachPolicyContext("pto"), async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const requestId = req.params.id as string;

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
      if (computedHours > maxConsecutiveHours) {
        return res.status(400).json({
          message: `Request exceeds the maximum consecutive hours allowed (${maxConsecutiveHours}).`,
        });
      }

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

      res.json(updated);
    } catch (error: any) {
      console.error("Error editing time off request:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to edit time off request" });
    }
  });

  app.get("/api/time-off", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const requests = await storage.getTimeOffRequestsByUser(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time off requests:", error);
      res.status(500).json({ message: "Failed to fetch time off requests" });
    }
  });

  app.get("/api/time-off/my-balance", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const balance = await storage.computeTimeOffBalanceDetailed(userId);
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ message: "Failed to fetch PTO balance" });
    }
  });

  app.get("/api/time-off/balance", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to fetch PTO balance" });
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
      res.status(500).json({ message: "Failed to fetch team time off" });
    }
  });

  app.get("/api/manager/team-stats", requireAuth, requireRole("manager", "admin"), requirePermission("attendance.view_team"), requestCache({ scope: "user" }), async (req, res) => {
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

  app.get("/api/manager/team-status", requireAuth, requireRole("manager", "admin"), requirePermission("attendance.view_team"), async (req, res) => {
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

    const teamStatus = teamMembers.map(member => {
      const todayRecord = todayAttendance.find(a => a.employeeId === member.id && a.clockIn && !a.clockOut);
      const todayRecords = todayAttendance.filter(a => a.employeeId === member.id);
      const hasPtoToday = allTimeOff.some(r =>
        r.userId === member.id && (r.status === "approved" || r.status === "partially_approved") && r.startDate <= today && (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
      );

      let todayHours = 0;
      todayRecords.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          todayHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        }
      });

      let weekHours = 0;
      const memberWeekRecords = weekAttendance.filter(a => a.employeeId === member.id);
      memberWeekRecords.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          weekHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        }
      });

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
    hoursApproved: z.number().positive().optional(),
    approvedEndDate: z.string().optional(),
  });

  app.post("/api/time-off/:id/approve", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
    try {
      const user = (req as any).authUser as User;
      const parsed = approvalSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request body" });
      const { comment, hoursApproved, approvedEndDate } = parsed.data;
      const requestId = req.params.id as string;
      const request = await storage.getTimeOffRequest(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

      const teamIds = await getTeamUserIds(user);
      if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to approve this request" });

      if (hoursApproved !== undefined && hoursApproved > (request.hoursRequested || 8)) {
        return res.status(400).json({ message: "Hours approved cannot exceed hours requested" });
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
        }).where(eq(timeOffRequests.id, requestId)).returning();

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

        return result;
      });

      res.json(updated);
    } catch (error) {
      console.error("Error approving time-off request:", error);
      res.status(500).json({ message: "Failed to approve time-off request" });
    }
  });

  app.post("/api/time-off/:id/deny", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
    try {
      const user = (req as any).authUser as User;
      const parsed = approvalSchema.safeParse(req.body);
      const comment = parsed.success ? parsed.data.comment : undefined;
      const requestId = req.params.id as string;
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
        }).where(eq(timeOffRequests.id, requestId)).returning();

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

        return result;
      });

      res.json(updated);
    } catch (error) {
      console.error("Error denying time-off request:", error);
      res.status(500).json({ message: "Failed to deny time-off request" });
    }
  });

  app.get("/api/time-off/processed", requireAuth, requireRole("manager", "admin"), requirePermission("pto.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const { department, location, type, status, startDate, endDate } = req.query as Record<string, string | undefined>;

    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const allDepartments = await storage.getAllDepartments();
    const allLocations = await storage.getAllLocations();
    const deptMap = new Map(allDepartments.map(d => [d.id, d.name]));
    const locMap = new Map(allLocations.map(l => [l.id, l.name]));
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    let scopedUserIds: string[] | undefined;

    if (user.role === "manager") {
      const teamIds = await getTeamUserIds(user);
      scopedUserIds = Array.from(teamIds);
    } else if (user.role === "admin") {
      let filteredUsers = allUsers;
      if (department) {
        filteredUsers = filteredUsers.filter(u => u.departmentId === department);
      }
      if (location) {
        filteredUsers = filteredUsers.filter(u => u.locationId === location);
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

    const enriched = requests.map(r => {
      const emp = userMap.get(r.userId);
      return {
        ...r,
        employeeName: emp ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim() : "Unknown",
        departmentName: emp?.departmentId ? (deptMap.get(emp.departmentId) || "N/A") : "N/A",
        locationName: emp?.locationId ? (locMap.get(emp.locationId) || "N/A") : "N/A",
        reviewerName: (() => {
          if (!r.reviewedBy) return "N/A";
          const u = userMap.get(r.reviewedBy);
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
        })(),
      };
    });
    res.json(enriched);
  });

  app.get("/api/admin/company-stats", requireAuth, requireRole("admin"), requirePermission("company.view"), requestCache({ scope: "user" }), async (req, res) => {
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

  app.get("/api/admin/department-breakdown", requireAuth, requireRole("admin"), requirePermission("departments.view"), async (req, res) => {
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const depts = await storage.getAllDepartments();
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const allTimeOff = await storage.getAllTimeOffRequests();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekAttendance = await storage.getAttendanceByDateRange(weekStartStr, today);

    const breakdown = depts.map(dept => {
      const deptUsers = allUsers.filter(u => u.departmentId === dept.id);
      const deptIds = new Set(deptUsers.map(u => u.id));
      const active = todayAttendance.filter(a => deptIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;
      const usingPto = allTimeOff.filter(r =>
        deptIds.has(r.userId) && (r.status === "approved" || r.status === "partially_approved") && r.startDate <= today && (r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate >= today : r.endDate >= today)
      ).length;

      let totalHours = 0;
      let recordCount = 0;
      weekAttendance.filter(a => deptIds.has(a.employeeId)).forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          totalHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
          recordCount++;
        }
      });
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

    const unassigned = allUsers.filter(u => !u.departmentId);
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

  app.get("/api/admin/recent-activity", requireAuth, requireRole("admin"), requirePermission("company.view"), async (req, res) => {
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
    requireRole("manager", "admin"),
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

      let departments = allDepartments;
      let locations = allLocations;

      if (user.role !== "admin") {
        const deptIds = new Set(scopedUsers.map(u => u.departmentId).filter(Boolean) as string[]);
        const locIds = new Set(scopedUsers.map(u => u.locationId).filter(Boolean) as string[]);
        departments = allDepartments.filter(d => deptIds.has(d.id));
        locations = allLocations.filter(l => locIds.has(l.id));
      }

      res.json({
        employees,
        departments: departments.map(d => ({ id: d.id, name: d.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        locations: locations.map(l => ({ id: l.id, name: l.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    },
  );

  const idArrayField = z.preprocess(
    (v) => (typeof v === "string" ? [v] : v),
    z.array(z.string().min(1)).optional(),
  );

  const reportSchema = z.object({
    reportType: z.enum(["employee", "team", "company"]),
    startDate: z.string(),
    endDate: z.string(),
    department: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.string().optional(),
    departmentIds: idArrayField,
    employeeIds: idArrayField,
    locationIds: idArrayField,
  });

  app.post("/api/reports/generate", requireAuth, requireRole("manager", "admin"), requirePermission("reports.view"), async (req, res) => {
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

    const { reportType, startDate, endDate, department, employeeId, status, departmentIds, employeeIds, locationIds } = parsed.data;
    const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
    const depts = await storage.getAllDepartments();
    const deptMap = new Map(depts.map(d => [d.id, d.name]));
    const attendance = await storage.getAttendanceByDateRange(startDate, endDate);
    const timeOff = await storage.getAllTimeOffRequests();

    const teamIds = await getTeamUserIds(user);
    let filteredUsers = allUsers.filter(u => teamIds.has(u.id));

    if (reportType === "employee" && employeeId) {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    } else if (reportType === "team") {
      if (user.departmentId) {
        filteredUsers = filteredUsers.filter(u => u.departmentId === user.departmentId);
      }
    }

    if (department && department !== "all") {
      filteredUsers = filteredUsers.filter(u => u.departmentId === department);
    }
    if (employeeId && reportType !== "employee") {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    }

    if (departmentIds && departmentIds.length > 0) {
      const set = new Set(departmentIds);
      filteredUsers = filteredUsers.filter(u => u.departmentId && set.has(u.departmentId));
    }
    if (employeeIds && employeeIds.length > 0) {
      const set = new Set(employeeIds);
      filteredUsers = filteredUsers.filter(u => set.has(u.id));
    }
    if (locationIds && locationIds.length > 0) {
      const set = new Set(locationIds);
      filteredUsers = filteredUsers.filter(u => u.locationId && set.has(u.locationId));
    }

    const userIds = new Set(filteredUsers.map(u => u.id));
    const filteredAttendance = attendance.filter(a => userIds.has(a.employeeId));
    let filteredTimeOff = timeOff.filter(r =>
      userIds.has(r.userId) &&
      r.startDate <= endDate &&
      r.endDate >= startDate
    );

    if (status && status !== "all") {
      filteredTimeOff = filteredTimeOff.filter(r => r.status === status);
    }

    const reportData = filteredUsers.map(user => {
      const userAttendance = filteredAttendance.filter(a => a.employeeId === user.id);
      // Shared with /api/attendance/timesheet/:employeeId — guarantees the
      // per-employee timesheet's totals row matches this report row exactly.
      const { totalHours, daysWorked } = computeAttendanceTotals(userAttendance);

      const userTimeOff = filteredTimeOff.filter(r => r.userId === user.id && (r.status === "approved" || r.status === "partially_approved"));
      let daysOff = 0;
      userTimeOff.forEach(r => {
        const start = new Date(r.startDate);
        const end = new Date(r.endDate);
        daysOff += Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      });

      const overtime = Math.max(0, totalHours - (daysWorked * 8));

      return {
        employeeId: user.id,
        employeeName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown",
        department: user.departmentId ? (deptMap.get(user.departmentId) || "Unassigned") : "Unassigned",
        totalHours: Math.round(totalHours * 10) / 10,
        daysWorked,
        daysOff,
        overtime: Math.round(overtime * 10) / 10,
      };
    });

    res.json(reportData);
  });

  app.get("/api/pto-policies", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const policies = await storage.getAllPtoPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching PTO policies:", error);
      res.status(500).json({ message: "Failed to fetch PTO policies" });
    }
  });

  app.get("/api/pto-policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policy = await storage.getPtoPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });
      res.json(policy);
    } catch (error) {
      console.error("Error fetching PTO policy:", error);
      res.status(500).json({ message: "Failed to fetch PTO policy" });
    }
  });

  app.post("/api/pto-policies", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertPtoPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy data", errors: parsed.error.flatten() });
      }
      const policy = await storage.createPtoPolicy(parsed.data);

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "pto_policy.created",
        targetId: policy.id,
        targetType: "pto_policy",
        newValue: { name: policy.name },
        ...getAuditContext(req),
      });

      res.status(201).json(policy);
    } catch (error) {
      console.error("Error creating PTO policy:", error);
      res.status(500).json({ message: "Failed to create PTO policy" });
    }
  });

  app.patch("/api/pto-policies/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const accrualType = req.body?.accrualType;
      if (accrualType === "per_hours_worked") {
        const perHours = Number(req.body?.vacationAccrualPerHoursWorked);
        const earned = Number(req.body?.vacationAccrualHoursPerThreshold);
        if (!Number.isFinite(perHours) || perHours <= 0) {
          return res.status(400).json({
            message: "Invalid policy data",
            errors: { vacationAccrualPerHoursWorked: "Hours worked per accrual must be a number greater than 0 when accrual type is per_hours_worked" },
          });
        }
        if (!Number.isFinite(earned) || earned < 0) {
          return res.status(400).json({
            message: "Invalid policy data",
            errors: { vacationAccrualHoursPerThreshold: "PTO hours earned per threshold must be a number greater than or equal to 0 when accrual type is per_hours_worked" },
          });
        }
      }
      const policy = await storage.updatePtoPolicy(req.params.id, req.body);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "pto_policy.updated",
        targetId: policy.id,
        targetType: "pto_policy",
        newValue: { name: policy.name, changes: Object.keys(req.body) },
        ...getAuditContext(req),
      });

      res.json(policy);
    } catch (error) {
      console.error("Error updating PTO policy:", error);
      res.status(500).json({ message: "Failed to update PTO policy" });
    }
  });

  app.get("/api/employee-pto-settings/:userId", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const settings = await storage.getEmployeePtoSettings(req.params.userId);
      if (!settings) return res.json(null);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching employee PTO settings:", error);
      res.status(500).json({ message: "Failed to fetch employee PTO settings" });
    }
  });

  app.post("/api/employee-pto-settings", requireAuth, requireRole("admin"), async (req: any, res) => {
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

      res.json(settings);
    } catch (error) {
      console.error("Error saving employee PTO settings:", error);
      res.status(500).json({ message: "Failed to save employee PTO settings" });
    }
  });

  app.patch("/api/employee-pto-settings/:userId", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const settings = await storage.updateEmployeePtoSettings(req.params.userId, req.body);
      if (!settings) return res.status(404).json({ message: "Employee PTO settings not found" });

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "employee_pto.balance_adjusted",
        targetId: req.params.userId,
        targetType: "employee_pto_settings",
        newValue: { changes: req.body },
        ...getAuditContext(req),
      });

      res.json(settings);
    } catch (error) {
      console.error("Error updating employee PTO settings:", error);
      res.status(500).json({ message: "Failed to update employee PTO settings" });
    }
  });

  app.get("/api/employee-pto-policy/:userId", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const policy = await storage.getEmployeePtoPolicy(req.params.userId);
      res.json(policy || null);
    } catch (error) {
      console.error("Error fetching employee PTO policy:", error);
      res.status(500).json({ message: "Failed to fetch employee PTO policy" });
    }
  });

  app.get("/api/audit-logs", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const module = req.query.module as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getAuditLogs(module, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
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
      res.status(500).json({ message: "Failed to fetch employee audit logs" });
    }
  });

  app.get("/api/policy-types", requireAuth, async (_req, res) => {
    try {
      const types = await storage.getAllPolicyTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching policy types:", error);
      res.status(500).json({ message: "Failed to fetch policy types" });
    }
  });

  app.get("/api/policies", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const policies = companyId
        ? await storage.getPoliciesByCompany(companyId)
        : await storage.getAllPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching policies:", error);
      res.status(500).json({ message: "Failed to fetch policies" });
    }
  });

  app.get("/api/policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policy = await storage.getPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const rules = await storage.getPolicyRulesByPolicy(policy.id);
      const assignments = await storage.getPolicyAssignmentsByPolicy(policy.id);
      res.json({ ...policy, rules: rules[0]?.rules || {}, assignments });
    } catch (error) {
      console.error("Error fetching policy:", error);
      res.status(500).json({ message: "Failed to fetch policy" });
    }
  });

  app.post("/api/policies", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy data", errors: parsed.error.flatten() });
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
    } catch (error) {
      console.error("Error creating policy:", error);
      res.status(500).json({ message: "Failed to create policy" });
    }
  });

  app.patch("/api/policies/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const { rules, ...policyData } = req.body;
      if (rules) {
        const overlapError = validateBonusRuleOverlaps(rules);
        if (overlapError) {
          return res.status(400).json({ message: overlapError });
        }
      }
      const policy = await storage.updatePolicy(req.params.id, policyData);
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
    } catch (error) {
      console.error("Error updating policy:", error);
      res.status(500).json({ message: "Failed to update policy" });
    }
  });

  app.post("/api/policies/:id/activate", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(req.params.id, { status: "active" });
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
      res.status(500).json({ message: "Failed to activate policy" });
    }
  });

  app.post("/api/policies/:id/archive", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(req.params.id, { status: "archived" });
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
      res.status(500).json({ message: "Failed to archive policy" });
    }
  });

  app.get("/api/policies/:id/rules", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const rules = await storage.getPolicyRulesByPolicy(req.params.id);
      res.json(rules[0]?.rules || {});
    } catch (error) {
      console.error("Error fetching policy rules:", error);
      res.status(500).json({ message: "Failed to fetch policy rules" });
    }
  });

  app.put("/api/policies/:id/rules", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.getPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const body = req.body && typeof req.body === "object" && "rules" in req.body && req.body.rules
        ? req.body.rules
        : req.body;
      const overlapError = validateBonusRuleOverlaps(body);
      if (overlapError) {
        return res.status(400).json({ message: overlapError });
      }
      const rule = await storage.upsertPolicyRules(req.params.id, body);

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
      res.status(500).json({ message: "Failed to update policy rules" });
    }
  });

  app.get("/api/roles-summary", requireAuth, requireRole("admin"), async (_req, res) => {
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
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.get("/api/policy-assignments", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policyId = req.query.policyId as string | undefined;
      const assignments = policyId
        ? await storage.getPolicyAssignmentsByPolicy(policyId)
        : await storage.getAllPolicyAssignments();
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching policy assignments:", error);
      res.status(500).json({ message: "Failed to fetch policy assignments" });
    }
  });

  app.post("/api/policy-assignments", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const isArray = Array.isArray(req.body);
      const items = isArray ? req.body : [req.body];

      if (items.length === 0) {
        return res.status(400).json({ message: "No assignments provided" });
      }

      const parsedItems: any[] = [];
      const errorsByIndex: Record<number, any> = {};
      items.forEach((item: unknown, idx: number) => {
        const parsed = insertPolicyAssignmentSchema.safeParse(item);
        if (parsed.success) {
          parsedItems.push(parsed.data);
        } else {
          errorsByIndex[idx] = parsed.error.flatten();
        }
      });
      if (Object.keys(errorsByIndex).length > 0) {
        return res.status(400).json({ message: "Invalid assignment data", errors: errorsByIndex });
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
      res.status(500).json({ message: "Failed to create policy assignment" });
    }
  });

  app.patch("/api/policy-assignments/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const assignment = await storage.updatePolicyAssignment(req.params.id, req.body);
      if (!assignment) return res.status(404).json({ message: "Policy assignment not found" });
      res.json(assignment);
    } catch (error) {
      console.error("Error updating policy assignment:", error);
      res.status(500).json({ message: "Failed to update policy assignment" });
    }
  });

  app.delete("/api/policy-assignments/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      await storage.deletePolicyAssignment(req.params.id);

      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "policy_assignment.deleted",
        targetId: req.params.id,
        targetType: "policy_assignment",
        ...getAuditContext(req),
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting policy assignment:", error);
      res.status(500).json({ message: "Failed to delete policy assignment" });
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
      res.status(500).json({ message: "Failed to fetch effective policy" });
    }
  });

  app.get("/api/policy-defaults/:policyType", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const defaults = getDefaultRulesForType(req.params.policyType);
      if (Object.keys(defaults).length === 0) {
        return res.status(404).json({ message: "Unknown policy type" });
      }
      res.json(defaults);
    } catch (error) {
      console.error("Error fetching policy defaults:", error);
      res.status(500).json({ message: "Failed to fetch policy defaults" });
    }
  });

  const payrollBatchCreateSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    companyId: z.string().optional(),
    notes: z.string().optional(),
  });

  app.get("/api/payroll/exports", requireAuth, requireRole("admin"), async (req, res) => {
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
      res.status(500).json({ message: "Failed to fetch payroll exports" });
    }
  });

  app.get("/api/payroll/exports/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });
      res.json(exp);
    } catch (error) {
      console.error("Error fetching payroll export:", error);
      res.status(500).json({ message: "Failed to fetch payroll export" });
    }
  });

  app.post("/api/payroll/exports", requireAuth, requireRole("admin"), async (req: any, res) => {
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

      const totalRecordCount = attendanceRecords.length + approvedTimeOff.length + approvedCashouts.length;

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

        for (const record of attendanceRecords) {
          const hours = record.hoursWorked || 0;
          const hasIssue = !record.clockIn || (!record.clockOut && record.status !== "in-progress");

          const empUser = userMap.get(record.employeeId);
          const empAttPolicy = empUser ? await getEffectivePolicy(empUser.companyId, record.employeeId, "attendance", empUser) : null;
          const empAttRules = empAttPolicy?.rules || DEFAULT_ATTENDANCE_RULES;
          const otThreshold = empAttRules.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;

          let regHours = hours;
          let otHours = 0;
          if (hours > otThreshold) {
            regHours = otThreshold;
            otHours = Math.round((hours - otThreshold) * 100) / 100;
          }

          const empPayrollPolicy = empUser ? await getEffectivePolicy(empUser.companyId, record.employeeId, "payroll", empUser) : null;
          const empPayrollRules = empPayrollPolicy?.rules || DEFAULT_PAYROLL_RULES;
          const bonusResult = evaluateDayOfWeekBonuses(record.workDate, hours, empPayrollRules);
          const earlyResult = evaluateEarlyArrivalBonuses(record.workDate, record.roundedClockIn ?? record.clockIn, hours, empPayrollRules);
          const combinedBonusAmount = Math.round((bonusResult.bonusAmount + earlyResult.bonusAmount) * 100) / 100;
          const combinedDescriptions = [...bonusResult.descriptions, ...earlyResult.descriptions];

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: record.employeeId,
            punchLogId: record.id,
            timeOffRequestId: null,
            recordType: "attendance",
            workDate: record.workDate,
            regularHours: regHours,
            overtimeHours: otHours,
            ptoHours: 0,
            bonusAmount: combinedBonusAmount,
            bonusHours: bonusResult.bonusHours,
            bonusDescription: combinedDescriptions.length > 0 ? combinedDescriptions.join("; ") : null,
            hasIssues: hasIssue,
            issueDescription: hasIssue ? `Missing punch data on ${record.workDate}` : null,
          });
        }

        for (const tor of approvedTimeOff) {
          const ptoHours = tor.hoursRequested || 8;
          const effectiveStart = tor.startDate > startDate ? tor.startDate : startDate;

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: tor.userId,
            punchLogId: null,
            timeOffRequestId: tor.id,
            recordType: "pto",
            workDate: effectiveStart,
            regularHours: 0,
            overtimeHours: 0,
            ptoHours,
            hasIssues: false,
            issueDescription: null,
          });
        }

        for (const co of approvedCashouts) {
          const cashoutHours = co.hoursRequested || 8;

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: co.userId,
            punchLogId: null,
            timeOffRequestId: co.id,
            recordType: "pto_cashout",
            workDate: co.startDate,
            regularHours: 0,
            overtimeHours: 0,
            ptoHours: cashoutHours,
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
        newValue: { startDate, endDate, recordCount: attendanceRecords.length + approvedTimeOff.length + approvedCashouts.length },
        ...auditCtx,
      });

      res.status(201).json({
        ...payrollExport,
        recordCount: attendanceRecords.length + approvedTimeOff.length,
        overlapWarning,
      });
    } catch (error) {
      console.error("Error creating payroll batch:", error);
      res.status(500).json({ message: "Failed to create payroll batch" });
    }
  });

  app.get("/api/payroll/exports/:id/records", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(req.params.id);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = records.map(r => {
        const user = userMap.get(r.employeeId);
        return {
          ...r,
          employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching batch records:", error);
      res.status(500).json({ message: "Failed to fetch batch records" });
    }
  });

  app.get("/api/payroll/exports/:id/summary", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(req.params.id);
      const allUsers = hideSuperAdmin(await storage.getAllUsers(), isSuperAdmin(req));
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const summary = new Map<string, { employeeId: string; employeeName: string; regularHours: number; overtimeHours: number; ptoHours: number; bonusHours: number; bonusAmount: number; hasIssues: boolean }>();

      for (const r of records) {
        if (!summary.has(r.employeeId)) {
          const user = userMap.get(r.employeeId);
          summary.set(r.employeeId, {
            employeeId: r.employeeId,
            employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
            regularHours: 0,
            overtimeHours: 0,
            ptoHours: 0,
            bonusHours: 0,
            bonusAmount: 0,
            hasIssues: false,
          });
        }
        const emp = summary.get(r.employeeId)!;
        emp.regularHours += r.regularHours || 0;
        emp.overtimeHours += r.overtimeHours || 0;
        emp.ptoHours += r.ptoHours || 0;
        emp.bonusHours += r.bonusHours || 0;
        emp.bonusAmount += r.bonusAmount || 0;
        if (r.hasIssues) emp.hasIssues = true;
      }

      res.json(Array.from(summary.values()));
    } catch (error) {
      console.error("Error fetching payroll summary:", error);
      res.status(500).json({ message: "Failed to fetch payroll summary" });
    }
  });

  app.post("/api/payroll/exports/:id/export-csv", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status === "locked") {
        return res.status(400).json({ message: "Cannot export a locked payroll batch. Reopen it first." });
      }

      const records = await storage.getPayrollBatchRecords(req.params.id);
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

      type DayRow = { employeeName: string; amount: number; payType: string; department: string; paidHours: number; dateWorked: string; sortDate: string; wasCorrected: boolean; bonusAmount: number; bonusDescriptions: string[] };
      const employeeRecords = new Map<string, Map<string, DayRow>>();

      for (const r of records) {
        const user = userMap.get(r.employeeId);
        const employeeName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown";
        const department = user?.departmentId ? (deptMap.get(user.departmentId) || "") : "";
        const profile = await getProfile(r.employeeId);
        const schedules = await getSchedules(r.employeeId);

        let hourlyRate = 0;
        if (profile) {
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
        const totalHours = (r.regularHours || 0) + (r.overtimeHours || 0) + (r.ptoHours || 0) + bonusHours;
        const amount = totalHours * hourlyRate + bonusAmount;

        const jsDayOfWeek = getDayOfWeek(r.workDate);
        const scheduledDays = schedules.filter(s => s.isActive).map(s => s.dayOfWeek);
        let payType = "Regular";
        if (r.recordType === "pto_cashout") {
          payType = "PTO Cash-Out";
        } else if (r.recordType === "pto") {
          payType = "Regular";
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
      csv += "Employee Name,Amount,Pay Type,Department,Paid Hours,Date Worked,Corrected,Bonus Amount,Bonus Description\n";

      for (const [, dayMap] of employeeRecords) {
        const rows = Array.from(dayMap.values()).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
        let totalAmount = 0;
        let totalPaidHours = 0;
        let totalBonusAmount = 0;

        for (const row of rows) {
          const bonusAmtCell = row.bonusAmount > 0 ? formatAmountCurrency(row.bonusAmount) : "";
          const bonusDescCell = row.bonusDescriptions.length > 0 ? escapeCSV(row.bonusDescriptions.join("; ")) : "";
          csv += `${escapeCSV(row.employeeName)},${formatAmountCurrency(row.amount)},${escapeCSV(row.payType)},${escapeCSV(row.department)},${formatHoursVal(row.paidHours)},${escapeCSV(row.dateWorked)},${row.wasCorrected ? "Yes" : ""},${bonusAmtCell},${bonusDescCell}\n`;
          totalAmount += row.amount;
          totalPaidHours += row.paidHours;
          totalBonusAmount += row.bonusAmount;
        }

        const empName = rows[0].employeeName;
        const totalBonusCell = totalBonusAmount > 0 ? formatAmountCurrency(totalBonusAmount) : "";
        csv += `${escapeCSV(empName + " - Paid Totals")},${formatAmountCurrency(totalAmount)},,,${formatHoursVal(totalPaidHours)},,,${totalBonusCell},\n`;
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

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="payroll_${exp.startDate}_to_${exp.endDate}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payroll CSV:", error);
      res.status(500).json({ message: "Failed to export payroll CSV" });
    }
  });

  app.post("/api/payroll/exports/:id/lock", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status !== "exported") {
        return res.status(400).json({ message: "Only exported batches can be locked" });
      }

      const adminUser = req.authUser as User;
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
        action: "payroll_export.locked",
        oldValue: { status: "exported" },
        newValue: { status: "locked" },
        ...auditCtx,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error locking payroll batch:", error);
      res.status(500).json({ message: "Failed to lock payroll batch" });
    }
  });

  app.post("/api/payroll/exports/:id/reopen", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
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
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.reopened",
        oldValue: { status: exp.status },
        newValue: { status: "reopened" },
        ...auditCtx,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error reopening payroll batch:", error);
      res.status(500).json({ message: "Failed to reopen payroll batch" });
    }
  });

  app.get("/api/payroll/exports/:id/adjustments", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const adjustments = await storage.getPayrollAdjustmentsByExport(req.params.id);
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching payroll adjustments:", error);
      res.status(500).json({ message: "Failed to fetch payroll adjustments" });
    }
  });

  app.get("/api/payroll/adjustments/pending", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const adjustments = await storage.getPendingPayrollAdjustments();
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching pending adjustments:", error);
      res.status(500).json({ message: "Failed to fetch pending adjustments" });
    }
  });

  app.post("/api/payroll/adjustments/:id/acknowledge", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const adjustment = await storage.getPayrollAdjustment(req.params.id);
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
      res.status(500).json({ message: "Failed to acknowledge adjustment" });
    }
  });

  app.get("/api/payroll/overlap-check", requireAuth, requireRole("admin"), async (req, res) => {
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
      res.status(500).json({ message: "Failed to check overlap" });
    }
  });

  app.get("/api/alerts", requireAuth, requireRole("admin", "manager"), requirePermission("alerts.view"), requestCache({ scope: "user" }), async (req, res) => {
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
      res.status(500).json({ message: "Failed to fetch alerts" });
    }
  });

  app.post("/api/alerts/detect", requireAuth, requireRole("admin"), requirePermission("alerts.manage"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to run alert detection" });
    }
  });

  app.post("/api/alerts/:id/acknowledge", requireAuth, requireRole("admin", "manager"), requirePermission("alerts.manage"), async (req: any, res) => {
    try {
      const alert = await storage.getSystemAlert(req.params.id);
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      const updated = await storage.updateSystemAlert(req.params.id, {
        status: "acknowledged",
        acknowledgedBy: req.authUser.id,
        acknowledgedAt: new Date(),
      });
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "system_alert",
        targetId: req.params.id,
        action: "alert.acknowledged",
        oldValue: { status: alert.status },
        newValue: { status: "acknowledged" },
        ...auditCtx,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error acknowledging alert:", error);
      res.status(500).json({ message: "Failed to acknowledge alert" });
    }
  });

  app.post("/api/alerts/:id/resolve", requireAuth, requireRole("admin", "manager"), requirePermission("alerts.manage"), async (req: any, res) => {
    try {
      const alert = await storage.getSystemAlert(req.params.id);
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      const updated = await storage.updateSystemAlert(req.params.id, {
        status: "resolved",
        resolvedBy: req.authUser.id,
        resolvedAt: new Date(),
      });
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "system_alert",
        targetId: req.params.id,
        action: "alert.resolved",
        oldValue: { status: alert.status },
        newValue: { status: "resolved" },
        ...auditCtx,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error resolving alert:", error);
      res.status(500).json({ message: "Failed to resolve alert" });
    }
  });

  app.get("/api/audit-logs/filtered", requireAuth, requireRole("admin"), requirePermission("audit.view"), requestCache({ scope: "user" }), async (req, res) => {
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
          const u = userMap.get(log.actorUserId);
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
        })(),
      }));
      res.json({ logs: enrichedLogs, total: result.total });
    } catch (error) {
      console.error("Error fetching filtered audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/roles", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      const allRoles = await storage.getAllRoles();
      const rolesWithPermissions = await Promise.all(
        allRoles.map(async (role) => {
          const perms = await storage.getRolePermissions(role.id);
          return { ...role, permissions: perms };
        })
      );
      const filtered = isSuperAdmin
        ? rolesWithPermissions
        : rolesWithPermissions.filter(r => !r.permissions.some((p: any) => p.key === "system.super_admin"));
      res.json(filtered);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.post("/api/roles", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to create role" });
    }
  });

  app.patch("/api/roles/:id", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin) {
        const existingPerms = await storage.getRolePermissions(req.params.id);
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
        role = await storage.updateRole(req.params.id, roleData);
      } else {
        role = await storage.getRole(req.params.id);
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
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.post("/api/roles/:id/duplicate", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const sourceRole = await storage.getRole(req.params.id);
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
      res.status(500).json({ message: "Failed to duplicate role" });
    }
  });

  app.delete("/api/roles/:id", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const role = await storage.getRole(req.params.id);
      if (!role) return res.status(404).json({ message: "Role not found" });
      if (role.isSystem) return res.status(400).json({ message: "Cannot delete system roles" });
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      if (!isSuperAdmin) {
        const rolePerms = await storage.getRolePermissions(role.id);
        if (rolePerms.some(p => p.key === "system.super_admin")) {
          return res.status(403).json({ message: "Cannot delete a role with super admin privileges" });
        }
      }
      await storage.deleteRole(req.params.id);
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "role",
        targetId: req.params.id,
        action: "role.deleted",
        oldValue: { name: role.name },
        ...auditCtx,
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  app.get("/api/permissions", requireAuth, requireRole("admin"), requirePermission("roles.manage"), async (req: any, res) => {
    try {
      const isSuperAdmin = req.userPermissions?.has("system.super_admin");
      const allPerms = await storage.getAllPermissions();
      const filteredPerms = isSuperAdmin ? allPerms : allPerms.filter(p => p.key !== "system.super_admin");
      res.json(filteredPerms);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get("/api/kiosk-devices", requireAuth, requireRole("admin"), requirePermission("kiosk.manage"), async (_req, res) => {
    try {
      const devices = await storage.getAllKioskDevices();
      res.json(devices);
    } catch (error) {
      console.error("Error fetching kiosk devices:", error);
      res.status(500).json({ message: "Failed to fetch kiosk devices" });
    }
  });

  app.post("/api/kiosk-devices", requireAuth, requireRole("admin"), requirePermission("kiosk.manage"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to create kiosk device" });
    }
  });

  app.patch("/api/kiosk-devices/:id", requireAuth, requireRole("admin"), requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.updateKioskDevice(req.params.id, req.body);
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
      res.status(500).json({ message: "Failed to update kiosk device" });
    }
  });

  app.delete("/api/kiosk-devices/:id", requireAuth, requireRole("admin"), requirePermission("kiosk.manage"), async (req: any, res) => {
    try {
      const device = await storage.getKioskDevice(req.params.id);
      if (!device) return res.status(404).json({ message: "Device not found" });
      await storage.deleteKioskDevice(req.params.id);
      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        targetType: "kiosk_device",
        targetId: req.params.id,
        action: "kiosk_device.deleted",
        oldValue: { name: device.name },
        ...auditCtx,
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting kiosk device:", error);
      res.status(500).json({ message: "Failed to delete kiosk device" });
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

  app.get("/api/role-rules", requireAuth, requireRole("admin"), async (_req, res) => {
    const rules = await storage.getAllRoleAssignmentRules();
    res.json(rules);
  });

  app.get("/api/role-rules/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const rule = await storage.getRoleAssignmentRule(req.params.id);
    if (!rule) return res.status(404).json({ message: "Rule not found" });
    res.json(rule);
  });

  app.post("/api/role-rules", requireAuth, requireRole("admin"), async (req: any, res) => {
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

  app.patch("/api/role-rules/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    const existing = await storage.getRoleAssignmentRule(req.params.id);
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
    const updated = await storage.updateRoleAssignmentRule(req.params.id, parsed.data);
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: req.params.id,
      action: "role_assignment_rule.update",
      oldValue: existing,
      newValue: updated,
      ...getAuditContext(req),
    });
    res.json(updated);
  });

  app.delete("/api/role-rules/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    const existing = await storage.getRoleAssignmentRule(req.params.id);
    if (!existing) return res.status(404).json({ message: "Rule not found" });
    await storage.deleteRoleAssignmentRule(req.params.id);
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "role_assignment_rule",
      targetId: req.params.id,
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
  app.post("/api/role-rules/reevaluate-all", requireAuth, requireRole("admin"), reevaluateAllHandler);
  app.post("/api/role-rules/re-evaluate", requireAuth, requireRole("admin"), reevaluateAllHandler);

  const roleRuleTestSchema = z.object({
    conditions: z.any(),
    targetRole: z.string().min(1).optional(),
    userIds: z.array(z.string().min(1)).max(500).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  });

  app.post("/api/role-rules/test", requireAuth, requireRole("admin"), async (req: any, res) => {
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

  app.get("/api/schedule-templates", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    const companyId = req.query.companyId as string | undefined;
    const templates = companyId
      ? await storage.getScheduleTemplatesByCompany(companyId)
      : await storage.getAllScheduleTemplates();
    res.json(templates);
  });

  app.get("/api/schedule-templates/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    const template = await storage.getScheduleTemplate(req.params.id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    const days = await storage.getScheduleTemplateDays(req.params.id);
    res.json({ ...template, days });
  });

  app.post("/api/schedule-templates", requireAuth, requireRole("admin"), async (req: any, res) => {
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

  app.patch("/api/schedule-templates/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    const existing = await storage.getScheduleTemplate(req.params.id);
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
    const updated = await storage.updateScheduleTemplate(req.params.id, updateFields);
    let updatedDays: any[] = await storage.getScheduleTemplateDays(req.params.id);
    if (days) {
      updatedDays = await storage.replaceScheduleTemplateDays(req.params.id, days);
    }
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "schedule_template",
      targetId: req.params.id,
      action: "schedule_template.update",
      oldValue: existing,
      newValue: { ...updated, days: updatedDays },
      ...getAuditContext(req),
    });
    res.json({ ...updated, days: updatedDays });
  });

  app.delete("/api/schedule-templates/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    const existing = await storage.getScheduleTemplate(req.params.id);
    if (!existing) return res.status(404).json({ message: "Template not found" });
    await storage.deleteScheduleTemplate(req.params.id);
    await writeAuditLog({
      actorUserId: req.authUser.id,
      targetType: "schedule_template",
      targetId: req.params.id,
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

  app.post("/api/schedule-templates/:id/apply", requireAuth, requireRole("admin"), async (req: any, res) => {
    const template = await storage.getScheduleTemplate(req.params.id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (!template.isActive) {
      return res.status(400).json({ message: "Template is inactive and can no longer be applied" });
    }
    const parsed = applyTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
    }
    const employeeIds = Array.from(new Set(parsed.data.employeeIds));
    if (employeeIds.length > 50) {
      const job = await enqueue("apply-schedule-template", {
        templateId: req.params.id,
        employeeIds,
        mode: parsed.data.mode,
        actorUserId: req.authUser.id,
      });
      return res.json({ async: true, jobId: job.id, employeeCount: employeeIds.length });
    }
    const result = await applyScheduleTemplate({
      templateId: req.params.id,
      employeeIds,
      mode: parsed.data.mode,
      actorUserId: req.authUser.id,
    });
    res.json({ async: false, ...result });
  });

  app.get("/api/workflows", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const allWorkflows = await storage.getAllWorkflows();
      res.json(allWorkflows);
    } catch (error) {
      console.error("Error fetching workflows:", error);
      res.status(500).json({ message: "Failed to fetch workflows" });
    }
  });

  app.get("/api/workflows/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const workflow = await storage.getWorkflow(req.params.id);
      if (!workflow) return res.status(404).json({ message: "Workflow not found" });
      res.json(workflow);
    } catch (error) {
      console.error("Error fetching workflow:", error);
      res.status(500).json({ message: "Failed to fetch workflow" });
    }
  });

  app.post("/api/workflows", requireAuth, requireRole("admin"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to create workflow" });
    }
  });

  app.patch("/api/workflows/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const existing = await storage.getWorkflow(req.params.id);
      if (!existing) return res.status(404).json({ message: "Workflow not found" });
      const { name, triggerType, policyTypeId, status, nodeGraph } = req.body;
      const updated = await storage.updateWorkflow(req.params.id, {
        ...(name !== undefined && { name }),
        ...(triggerType !== undefined && { triggerType }),
        ...(policyTypeId !== undefined && { policyTypeId }),
        ...(status !== undefined && { status }),
        ...(nodeGraph !== undefined && { nodeGraph }),
      });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "workflow.updated",
        targetId: req.params.id,
        targetType: "workflow",
        oldValue: { name: existing.name, status: existing.status },
        newValue: { name: updated?.name, status: updated?.status },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating workflow:", error);
      res.status(500).json({ message: "Failed to update workflow" });
    }
  });

  app.delete("/api/workflows/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const existing = await storage.getWorkflow(req.params.id);
      if (!existing) return res.status(404).json({ message: "Workflow not found" });
      await storage.deleteWorkflow(req.params.id);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "workflow.deleted",
        targetId: req.params.id,
        targetType: "workflow",
        oldValue: { name: existing.name },
        ...getAuditContext(req),
      });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting workflow:", error);
      res.status(500).json({ message: "Failed to delete workflow" });
    }
  });

  // ===== Performance review cycles =====
  app.get("/api/review-cycles", requireAuth, requireRole("admin"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to fetch review cycles" });
    }
  });

  app.post("/api/review-cycles", requireAuth, requireRole("admin"), async (req: any, res) => {
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
      res.status(500).json({ message: "Failed to create review cycle" });
    }
  });

  app.patch("/api/review-cycles/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewCycle(req.params.id);
      if (!existing) return res.status(404).json({ message: "Review cycle not found" });
      const parsed = insertPerformanceReviewCycleSchema.partial().parse(req.body);
      const updated = await storage.updateReviewCycle(req.params.id, parsed);
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_cycle.updated",
        targetType: "review_cycle",
        targetId: req.params.id,
        oldValue: { name: existing.name, isActive: existing.isActive },
        newValue: { name: updated?.name, isActive: updated?.isActive },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid review cycle", issues: err.issues });
      console.error("[PATCH /api/review-cycles/:id]", err);
      res.status(500).json({ message: "Failed to update review cycle" });
    }
  });

  app.delete("/api/review-cycles/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewCycle(req.params.id);
      if (!existing) return res.status(404).json({ message: "Review cycle not found" });
      const updated = await storage.updateReviewCycle(req.params.id, { isActive: false });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_cycle.deactivated",
        targetType: "review_cycle",
        targetId: req.params.id,
        oldValue: { isActive: existing.isActive },
        newValue: { isActive: false },
        ...getAuditContext(req),
      });
      res.json(updated);
    } catch (err) {
      console.error("[DELETE /api/review-cycles/:id]", err);
      res.status(500).json({ message: "Failed to deactivate review cycle" });
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
      res.status(500).json({ message: "Failed to fetch review reminders" });
    }
  });

  app.patch("/api/review-reminders/:id", requireAuth, requireRole("admin", "manager"), async (req: any, res) => {
    try {
      const existing = await storage.getReviewReminder(req.params.id);
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
      const updated = await storage.updateReviewReminder(req.params.id, {
        status: parsed.status,
        completedBy: req.authUser.id,
        notes: parsed.notes,
      });
      await writeAuditLog({
        actorUserId: req.authUser.id,
        action: "review_reminder.updated",
        targetType: "review_reminder",
        targetId: req.params.id,
        oldValue: { status: existing.status },
        newValue: { status: parsed.status, notes: parsed.notes ?? null },
        ...getAuditContext(req),
      });
      if (parsed.status === "completed" || parsed.status === "skipped") {
        await storage.resolveReviewDueAlertsFor(req.params.id, req.authUser.id);
      }
      res.json(updated);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid update", issues: err.issues });
      console.error("[PATCH /api/review-reminders/:id]", err);
      res.status(500).json({ message: "Failed to update reminder" });
    }
  });

  // ===== PTO anniversary adjustments (read-only) =====
  app.get("/api/users/:id/pto-anniversary-adjustments", requireAuth, async (req: any, res) => {
    try {
      const targetId = req.params.id;
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
      res.status(500).json({ message: "Failed to fetch anniversary adjustments" });
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
      return res.status(500).json({ ok: false, message: String(err?.message || err) });
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

  // ===================== Lifecycle Wizards: Onboarding =====================

  app.get("/api/onboarding-templates", requireAuth, requireRole("admin"), requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    const requestedCompanyId = (req.query.companyId as string | undefined) ?? actor.companyId ?? null;
    if (!isSuperAdmin(req) && requestedCompanyId !== null && requestedCompanyId !== (actor.companyId ?? null)) {
      return res.status(403).json({ message: "Forbidden: cannot list templates for another company" });
    }
    const templates = await storage.getOnboardingTemplates({ companyId: requestedCompanyId });
    res.json(templates);
  });

  app.get("/api/onboarding-templates/:id", requireAuth, requireRole("admin"), requirePermission("users.view"), async (req, res) => {
    const t = await storage.getOnboardingTemplate(req.params.id);
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const tasks = await storage.getOnboardingTemplateTasks(t.id);
    res.json({ ...t, tasks });
  });

  app.post("/api/onboarding-templates", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
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

  app.patch("/api/onboarding-templates/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const before = await storage.getOnboardingTemplate(req.params.id);
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
    const updated = await storage.updateOnboardingTemplate(req.params.id, parsed.data);
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

  app.post("/api/onboarding-templates/:templateId/tasks", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOnboardingTemplate(req.params.templateId);
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const parsed = insertOnboardingTemplateTaskSchema.safeParse({ ...req.body, templateId: req.params.templateId });
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const docCheck = validateOnboardingDocumentType(parsed.data.documentType);
    if (!docCheck.ok) return res.status(400).json({ message: docCheck.message });
    const created = await storage.createOnboardingTemplateTask(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.create", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/onboarding-template-tasks/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOnboardingTemplateTaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const existingTask = await storage.getOnboardingTemplateTask(req.params.id);
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
    const updated = await storage.updateOnboardingTemplateTask(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.update", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: updated.id, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.delete("/api/onboarding-template-tasks/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const existingTask = await storage.getOnboardingTemplateTask(req.params.id);
    if (!existingTask) return res.status(204).end();
    const parent = await storage.getOnboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.deleteOnboardingTemplateTask(req.params.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_template_task.delete", actorUserId: (req as any).authUser.id, targetType: "onboarding_template_task", targetId: req.params.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
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
    if (actor.role !== "admin" && actor.id !== req.params.employeeId) {
      if (actor.role === "manager") {
        const team = await getTeamUserIds(actor);
        if (!team.has(req.params.employeeId)) return res.status(403).json({ message: "Forbidden" });
        isManagerOnTeam = true;
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }
    }
    const cl = await storage.getOnboardingChecklistByEmployee(req.params.employeeId);
    if (!cl) return res.json(null);
    const tasks = await storage.getOnboardingTasks(cl.id);
    // Self-only viewers (employee, not admin/manager-on-team) see only their own role's tasks.
    const isSelfOnly = actor.id === req.params.employeeId && actor.role !== "admin" && !isManagerOnTeam;
    const visibleTasks = isSelfOnly
      ? tasks.filter(t => t.ownerRole === "new_hire" || t.ownerRole === "system")
      : tasks;
    const progress = await storage.computeOnboardingProgress(cl.id);
    res.json({ ...cl, tasks: visibleTasks, progress });
  });

  app.get("/api/onboarding-checklists/:id", requireAuth, async (req, res) => {
    const cl = await storage.getOnboardingChecklist(req.params.id);
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
  app.post("/api/employees/:id/start-onboarding", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = startOnboardingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
    const employee = await storage.getUser(req.params.id);
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
    const task = await storage.getOnboardingTask(req.params.id);
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
    const updated = await storage.updateOnboardingTask(req.params.id, {
      status: parsed.data.status,
      notes: "notes" in parsed.data ? parsed.data.notes : undefined,
      skippedReason: "skippedReason" in parsed.data ? parsed.data.skippedReason : undefined,
      completedAt: completing ? new Date() : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
      completedBy: completing ? actor.id : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
    });
    const completed = await storage.completeOnboardingChecklistIfFinished(task.checklistId);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding_task.update", actorUserId: actor.id, targetType: "onboarding_task", targetId: req.params.id, oldValue: task, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    if (completed) {
      await writeAuditLog({ action: "onboarding.complete", actorUserId: actor.id, targetType: "onboarding_checklist", targetId: task.checklistId, newValue: { trigger: "task_update" }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    }
    res.json(updated);
  });

  app.post("/api/onboarding-checklists/:id/cancel", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Cancelled by admin";
    const updated = await storage.cancelOnboardingChecklist(req.params.id, reason, (req as any).authUser.id);
    if (!updated) return res.status(404).json({ message: "Checklist not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "onboarding.cancel", actorUserId: (req as any).authUser.id, targetType: "onboarding_checklist", targetId: req.params.id, newValue: { reason }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  // ===================== Lifecycle Wizards: Offboarding =====================

  app.get("/api/offboarding-templates", requireAuth, requireRole("admin"), requirePermission("users.view"), async (req, res) => {
    const actor = (req as any).authUser as User;
    const requestedCompanyId = (req.query.companyId as string | undefined) ?? actor.companyId ?? null;
    if (!isSuperAdmin(req) && requestedCompanyId !== null && requestedCompanyId !== (actor.companyId ?? null)) {
      return res.status(403).json({ message: "Forbidden: cannot list templates for another company" });
    }
    const templates = await storage.getOffboardingTemplates({ companyId: requestedCompanyId });
    res.json(templates);
  });

  app.get("/api/offboarding-templates/:id", requireAuth, requireRole("admin"), requirePermission("users.view"), async (req, res) => {
    const t = await storage.getOffboardingTemplate(req.params.id);
    if (!t) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, t, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const tasks = await storage.getOffboardingTemplateTasks(t.id);
    res.json({ ...t, tasks });
  });

  app.post("/api/offboarding-templates", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
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

  app.patch("/api/offboarding-templates/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", errors: parsed.error.flatten() });
    const before = await storage.getOffboardingTemplate(req.params.id);
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
    const updated = await storage.updateOffboardingTemplate(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Template not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template.update", actorUserId: (req as any).authUser.id, targetType: "offboarding_template", targetId: updated.id, oldValue: before, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.post("/api/offboarding-templates/:templateId/tasks", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parent = await storage.getOffboardingTemplate(req.params.templateId);
    if (!parent) return res.status(404).json({ message: "Template not found" });
    const actor = (req as any).authUser as User;
    if (!actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const parsed = insertOffboardingTemplateTaskSchema.safeParse({ ...req.body, templateId: req.params.templateId });
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const created = await storage.createOffboardingTemplateTask(parsed.data);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.create", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: created.id, newValue: created, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(201).json(created);
  });

  app.patch("/api/offboarding-template-tasks/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertOffboardingTemplateTaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
    const existingTask = await storage.getOffboardingTemplateTask(req.params.id);
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
    const updated = await storage.updateOffboardingTemplateTask(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.update", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: updated.id, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.delete("/api/offboarding-template-tasks/:id", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const existingTask = await storage.getOffboardingTemplateTask(req.params.id);
    if (!existingTask) return res.status(204).end();
    const parent = await storage.getOffboardingTemplate(existingTask.templateId);
    const actor = (req as any).authUser as User;
    if (!parent || !actorCanAccessLifecycleTemplate(actor, parent, isSuperAdmin(req))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.deleteOffboardingTemplateTask(req.params.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_template_task.delete", actorUserId: (req as any).authUser.id, targetType: "offboarding_template_task", targetId: req.params.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.status(204).end();
  });

  app.get("/api/offboarding-checklists", requireAuth, requireRole("admin", "manager"), async (req, res) => {
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

  app.get("/api/offboarding-checklists/by-employee/:employeeId", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    const actor = (req as any).authUser as User;
    if (actor.role === "manager") {
      const team = await getTeamUserIds(actor);
      if (!team.has(req.params.employeeId)) return res.status(403).json({ message: "Forbidden" });
    }
    const cl = await storage.getOffboardingChecklistByEmployee(req.params.employeeId);
    if (!cl) return res.json(null);
    const tasks = await storage.getOffboardingTasks(cl.id);
    const gate = await evaluateDeactivationGate(cl.id);
    const progress = await storage.computeOffboardingProgress(cl.id);
    res.json({ ...cl, tasks, gate, progress });
  });

  app.get("/api/offboarding-checklists/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    const cl = await storage.getOffboardingChecklist(req.params.id);
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
  app.post("/api/offboarding/start", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = startOffboardingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
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
  app.patch("/api/offboarding-tasks/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    const parsed = updateOffboardingTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid task update", errors: parsed.error.flatten() });
    const task = await storage.getOffboardingTask(req.params.id);
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
    const updated = await storage.updateOffboardingTask(req.params.id, {
      status: parsed.data.status,
      notes: "notes" in parsed.data ? parsed.data.notes : undefined,
      skippedReason: "skippedReason" in parsed.data ? parsed.data.skippedReason : undefined,
      completedAt: completing ? new Date() : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
      completedBy: completing ? actor.id : (parsed.data.status && parsed.data.status !== "completed" ? null : undefined),
    });
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "offboarding_task.update", actorUserId: actor.id, targetType: "offboarding_task", targetId: req.params.id, oldValue: task, newValue: updated, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    res.json(updated);
  });

  app.post("/api/offboarding-checklists/:id/deactivate", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const cl = await storage.getOffboardingChecklist(req.params.id);
    if (!cl) return res.status(404).json({ message: "Checklist not found" });
    if (cl.employeeId === SUPER_ADMIN_USER_ID && !isSuperAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const gate = await evaluateDeactivationGate(req.params.id);
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
      return res.status(500).json({ message: "Failed to write termination date to employment profile" });
    }

    await storage.setUserDeactivated(cl.employeeId, actor.id);
    const updated = await storage.setOffboardingChecklistDeactivation(req.params.id, actor.id);

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
    const u = await storage.getUser(req.params.id);
    if (!u) return res.status(404).json({ message: "User not found" });
    const updated = await storage.clearUserDeactivated(req.params.id);
    const ctx = getAuditContext(req);
    await writeAuditLog({ action: "user.reactivate", actorUserId: (req as any).authUser.id, targetType: "user", targetId: req.params.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
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
      const id = req.params.id;
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
      const id = req.params.id;
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
      const id = req.params.id;
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
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
      const userId = req.params.id;
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
      const userId = req.params.id;
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

  // ---- Kiosk public face flow ----
  app.post("/api/kiosk/face/identify", async (req, res) => {
    const device = await getKioskDeviceFromReq(req);
    if (!device) {
      return res.status(403).json({ error: "Unknown or inactive kiosk device" });
    }
    const settings = await storage.getBiometricSettings();
    if (!isFeatureEnabled(settings)) {
      return res.status(503).json({ error: "Face login is disabled" });
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
      return res.status(400).json({ error: "Invalid face descriptor" });
    }
    if (settings.livenessRequired && req.body?.livenessPassed !== true) {
      await storage.recordBiometricAttempt({
        kioskDeviceId: device.id,
        outcome: "liveness_failed",
        confidence: null,
        livenessPassed: false,
      });
      return res.status(400).json({ error: "Liveness check failed", outcome: "liveness_failed" });
    }

    const candidatesRaw = await storage.getBiometricTemplatesByCompanyAndType(
      device.companyId ?? null,
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
        return res.status(404).json({ error: "Matched user not found" });
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
      return res.json({
        outcome: "auto_approved",
        confidence: match.confidence,
        attemptId: attempt.id,
        employee: sanitizeUserForKiosk(user, deptName),
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
  });

  app.post("/api/kiosk/face/supervisor-override", async (req, res) => {
    const device = await getKioskDeviceFromReq(req);
    if (!device) {
      return res.status(403).json({ error: "Unknown or inactive kiosk device" });
    }
    const supervisorPin = req.body?.supervisorPin as string | undefined;
    const targetEmployeeId = req.body?.targetEmployeeId as string | undefined;
    const reason = (req.body?.reason as string | undefined) ?? "kiosk_override";
    const attemptId = req.body?.attemptId as string | undefined;
    if (!supervisorPin || !targetEmployeeId) {
      return res.status(400).json({ error: "supervisorPin and targetEmployeeId are required" });
    }
    const supervisor = await storage.getUserByPin(supervisorPin);
    if (!supervisor) {
      return res.status(403).json({ error: "Invalid supervisor PIN" });
    }
    if (supervisor.role !== "admin" && supervisor.role !== "manager") {
      return res.status(403).json({ error: "Only managers or admins can override" });
    }
    const target = await storage.getUser(targetEmployeeId);
    if (!target) return res.status(404).json({ error: "Target employee not found" });

    const override = await storage.recordBiometricSupervisorOverride({
      supervisorUserId: supervisor.id,
      targetUserId: target.id,
      kioskDeviceId: device.id,
      attemptId: attemptId ?? null,
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
    res.json({
      ok: true,
      overrideId: override.id,
      employee: sanitizeUserForKiosk(target, deptName),
      lastRecord: kioskLastRecord,
    });
  });

  return httpServer;
}
