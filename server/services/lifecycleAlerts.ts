import { db } from "../db";
import {
  users,
  certifications,
  requiredDocumentRules,
  systemAlerts,
  userEmploymentProfiles,
  type RequiredDocumentRule,
  type User,
  type PerformanceReviewCycle,
  type PerformanceReviewReminder,
  userDepartmentIds,
  userLocationIds,
} from "@shared/schema";
import { and, eq, isNull, or, gt, sql, desc, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { getEffectivePolicy, DEFAULT_CERTIFICATION_RULES } from "../policyEngine";
import type { GeneratedAlert } from "./alerts";
import type { PolicyAlert } from "./policyEnforcement";
import { createPolicyAlerts } from "./policyEnforcement";

const REQUIRED_DOC_LABELS: Record<string, string> = {
  w9: "W-9",
  i9: "I-9",
  direct_deposit: "Direct Deposit Authorization",
  emergency_contact: "Emergency Contact Form",
  handbook_ack: "Employee Handbook Acknowledgment",
};

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ===== Performance review reminders (Task #92) =====

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseDateString(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if ([y, m, d].some(Number.isNaN)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDays(target: Date, base: Date): number {
  const ms = target.getTime() - base.getTime();
  return Math.round(ms / 86_400_000);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

type ActiveEmployee = User & { hireDate: string | null };

function userCreatedAtDate(user: User): string | null {
  const ca = user.createdAt;
  if (!ca) return null;
  if (isNaN(ca.getTime())) return null;
  return ca.toISOString().split("T")[0];
}

function effectiveHireDate(employee: ActiveEmployee): string | null {
  return employee.hireDate ?? userCreatedAtDate(employee);
}

async function getActiveEmployees(): Promise<ActiveEmployee[]> {
  const today = todayStr();
  const rows = await db
    .select({
      user: users,
      profile: userEmploymentProfiles,
    })
    .from(users)
    .leftJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, users.id))
    .where(
      and(
        eq(users.role, "employee"),
        or(
          isNull(userEmploymentProfiles.terminationDate),
          gt(userEmploymentProfiles.terminationDate, today),
        ),
      ),
    );

  return rows.map((r) => ({
    ...r.user,
    hireDate: r.profile?.hireDate ?? null,
  }));
}

function ruleAppliesTo(rule: RequiredDocumentRule, user: User): boolean {
  switch (rule.scopeType) {
    case "global":
      return true;
    case "company":
      return !!rule.companyId && rule.companyId === user.companyId;
    case "location":
      return !!rule.locationId && userLocationIds(user).includes(rule.locationId);
    case "department":
      return !!rule.departmentId && userDepartmentIds(user).includes(rule.departmentId);
    case "employee":
      return !!rule.employeeId && rule.employeeId === user.id;
    default:
      return false;
  }
}

function ruleSpecificity(rule: RequiredDocumentRule): number {
  switch (rule.scopeType) {
    case "employee":
      return 4;
    case "department":
      return 3;
    case "location":
      return 2;
    case "company":
      return 1;
    case "global":
    default:
      return 0;
  }
}

export async function resolveRequiredDocumentTypesForEmployee(
  user: User,
): Promise<{ documentType: string; dueOffsetDays: number }[]> {
  const allRules = await storage.getAllRequiredDocumentRules({ isActive: true });
  const applicable = allRules.filter((r) => ruleAppliesTo(r, user));

  const byType = new Map<string, RequiredDocumentRule>();
  for (const rule of applicable) {
    const existing = byType.get(rule.documentType);
    if (!existing || ruleSpecificity(rule) > ruleSpecificity(existing)) {
      byType.set(rule.documentType, rule);
    }
  }

  return Array.from(byType.values()).map((r) => ({
    documentType: r.documentType,
    dueOffsetDays: r.dueOffsetDays,
  }));
}

export async function detectPerformanceReviewsDue(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const cycles: PerformanceReviewCycle[] = await storage.getReviewCycles({ isActive: true });
  if (cycles.length === 0) return alerts;

  const today = todayUtcMidnight();
  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const reminders: PerformanceReviewReminder[] = await storage.listReviewReminders({
    status: "pending",
  });

  for (const reminder of reminders) {
    const cycle = cycleById.get(reminder.cycleId);
    if (!cycle) continue;
    const due = parseDateString(reminder.dueDate);
    if (!due) continue;
    const daysUntil = diffDays(due, today);
    const leadTimes = Array.isArray(cycle.leadTimes) ? cycle.leadTimes : [14, 7, 0];
    if (!leadTimes.includes(daysUntil)) continue;

    const severity = daysUntil === 0 ? "high" : "medium";
    const dueLabel =
      daysUntil === 0
        ? `due today`
        : daysUntil > 0
          ? `due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
          : `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`;
    alerts.push({
      type: "review_due",
      severity,
      employeeId: reminder.employeeId,
      message: `Performance review (${cycle.name}) ${dueLabel}`,
      details: {
        reminderId: reminder.id,
        cycleId: cycle.id,
        cycleName: cycle.name,
        dueDate: reminder.dueDate,
        leadTime: daysUntil,
      },
    });
  }

  return alerts;
}

async function resolveOpenMissingDocAlert(alertId: string): Promise<void> {
  await storage.updateSystemAlert(alertId, { status: "resolved", resolvedAt: new Date() });
}

export async function auditOpenMissingDocumentAlerts(): Promise<void> {
  const open = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.type, "missing_document"),
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    );
  if (open.length === 0) return;

  const activeEmployees = await getActiveEmployees();
  const activeMap = new Map(activeEmployees.map((e) => [e.id, e]));

  for (const alert of open) {
    try {
      const employee = alert.employeeId ? activeMap.get(alert.employeeId) : null;
      if (!employee) {
        await resolveOpenMissingDocAlert(alert.id);
        continue;
      }
      const docType = (alert.details as Record<string, unknown> | null)?.documentType as string | undefined;
      if (!docType) continue;

      const required = await resolveRequiredDocumentTypesForEmployee(employee);
      const stillRequired = required.some((r) => r.documentType === docType);
      if (!stillRequired) {
        await resolveOpenMissingDocAlert(alert.id);
        continue;
      }

      const docs = await storage.getDocumentsByEmployee(employee.id);
      const satisfied = docs.some((d) => d.documentType === docType && d.status !== "rejected");
      if (satisfied) {
        await resolveOpenMissingDocAlert(alert.id);
      }
    } catch (err) {
      console.warn("auditOpenMissingDocumentAlerts: failed to audit alert", alert.id, err);
    }
  }
}

export async function detectMissingDocuments(): Promise<GeneratedAlert[]> {
  await auditOpenMissingDocumentAlerts();

  const alerts: GeneratedAlert[] = [];
  const today = todayStr();
  const employees = await getActiveEmployees();

  for (const employee of employees) {
    const policy = await getEffectivePolicy(employee.companyId, employee.id, "certifications", employee);
    const rules = { ...DEFAULT_CERTIFICATION_RULES, ...(policy?.rules || {}) };

    const required = await resolveRequiredDocumentTypesForEmployee(employee);
    if (required.length === 0) continue;

    const docs = await storage.getDocumentsByEmployee(employee.id);
    const haveTypes = new Set(
      docs.filter((d) => d.status !== "rejected").map((d) => d.documentType),
    );

    const baseDate = effectiveHireDate(employee);
    if (!baseDate) continue;
    const hireDate = employee.hireDate;

    for (const req of required) {
      if (haveTypes.has(req.documentType)) continue;
      const dueDate = new Date(baseDate + "T00:00:00Z");
      dueDate.setUTCDate(dueDate.getUTCDate() + req.dueOffsetDays);
      const dueStr = dueDate.toISOString().split("T")[0];
      if (dueStr > today) continue;

      const overdueDays = daysBetween(dueStr, today);
      const label = REQUIRED_DOC_LABELS[req.documentType] || req.documentType;
      alerts.push({
        type: "missing_document",
        severity: "high",
        employeeId: employee.id,
        message: `Missing required document: ${label}`,
        details: {
          documentType: req.documentType,
          documentLabel: label,
          dueDate: dueStr,
          overdueDays,
          hireDate,
          policyName: policy?.policyName || "Default",
        },
      });
    }
  }

  return alerts;
}

function classifyCertStatus(expirationDate: string | null, warningDays: number[]): {
  status: "valid" | "expiring_soon" | "expired";
  daysUntil: number | null;
} {
  if (!expirationDate) return { status: "valid", daysUntil: null };
  const today = todayStr();
  const days = daysBetween(today, expirationDate);
  if (days < 0) return { status: "expired", daysUntil: days };
  const maxWarn = Math.max(...warningDays);
  if (days <= maxWarn) return { status: "expiring_soon", daysUntil: days };
  return { status: "valid", daysUntil: days };
}

export async function syncCertificationStatuses(): Promise<void> {
  const all = await storage.getAllCertifications();
  for (const cert of all) {
    if (cert.status === "archived") continue;
    const employee = await storage.getUser(cert.employeeId);
    if (!employee) continue;
    const policy = await getEffectivePolicy(employee.companyId, employee.id, "certifications", employee);
    const rules = { ...DEFAULT_CERTIFICATION_RULES, ...(policy?.rules || {}) };
    const { status } = classifyCertStatus(cert.expirationDate, rules.warningThresholdsDays);
    if (status !== cert.status) {
      await storage.updateCertification(cert.id, { status });
    }
  }
}

async function pickNextUntriggeredThreshold(
  certificationId: string,
  daysUntil: number,
  warningDays: number[],
): Promise<number | null> {
  const sortedAsc = [...warningDays].sort((a, b) => a - b);
  let mostUrgent: number | null = null;
  for (const threshold of sortedAsc) {
    if (daysUntil <= threshold) {
      mostUrgent = threshold;
      break;
    }
  }
  if (mostUrgent === null) return null;
  const existing = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.type, "certification_expiring"),
        sql`${systemAlerts.details}->>'certificationId' = ${certificationId}`,
        sql`(${systemAlerts.details}->>'warningThreshold')::int = ${mostUrgent}`,
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;
  return mostUrgent;
}

async function findExistingCertAlert(
  employeeId: string,
  certificationId: string,
  type: "certification_expiring" | "certification_expired",
) {
  const rows = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.type, type),
        eq(systemAlerts.employeeId, employeeId),
        sql`${systemAlerts.details}->>'certificationId' = ${certificationId}`,
      ),
    )
    .orderBy(desc(systemAlerts.createdAt))
    .limit(1);
  return rows[0];
}

async function resolveOpenCertExpiringAlerts(certificationId: string): Promise<void> {
  const open = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.type, "certification_expiring"),
        sql`${systemAlerts.details}->>'certificationId' = ${certificationId}`,
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    );
  for (const a of open) {
    await storage.updateSystemAlert(a.id, { status: "resolved", resolvedAt: new Date() });
  }
}

async function auditOpenCertificationAlerts(activeIds: Set<string>): Promise<void> {
  const open = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        inArray(systemAlerts.type, ["certification_expiring", "certification_expired"]),
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    );
  if (open.length === 0) return;

  for (const alert of open) {
    try {
      const certificationId = (alert.details as Record<string, unknown> | null)?.certificationId as string | undefined;
      if (!certificationId) continue;

      const cert = await storage.getCertification(certificationId);
      if (!cert || cert.status === "archived") {
        await storage.updateSystemAlert(alert.id, { status: "resolved", resolvedAt: new Date() });
        continue;
      }
      if (!activeIds.has(cert.employeeId)) {
        await storage.updateSystemAlert(alert.id, { status: "resolved", resolvedAt: new Date() });
        continue;
      }
      if (!cert.expirationDate) {
        await storage.updateSystemAlert(alert.id, { status: "resolved", resolvedAt: new Date() });
        continue;
      }

      const employee = await storage.getUser(cert.employeeId);
      const policy = employee
        ? await getEffectivePolicy(employee.companyId, employee.id, "certifications", employee)
        : null;
      const rules = { ...DEFAULT_CERTIFICATION_RULES, ...(policy?.rules || {}) };
      const warningDays: number[] = rules.warningThresholdsDays || DEFAULT_CERTIFICATION_RULES.warningThresholdsDays;
      const { status } = classifyCertStatus(cert.expirationDate, warningDays);

      if (status === "valid") {
        await storage.updateSystemAlert(alert.id, { status: "resolved", resolvedAt: new Date() });
      } else if (status === "expiring_soon" && alert.type === "certification_expired") {
        await storage.updateSystemAlert(alert.id, { status: "resolved", resolvedAt: new Date() });
      }
    } catch (err) {
      console.warn("auditOpenCertificationAlerts: failed to audit alert", alert.id, err);
    }
  }
}

export async function detectExpiringCertifications(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const employees = await getActiveEmployees();
  const activeIds = new Set(employees.map((e) => e.id));

  await auditOpenCertificationAlerts(activeIds);

  const certs = await storage.getAllCertifications();

  for (const cert of certs) {
    if (cert.status === "archived") continue;
    if (!activeIds.has(cert.employeeId)) continue;
    if (!cert.expirationDate) continue;

    const employee = employees.find((e) => e.id === cert.employeeId);
    if (!employee) continue;

    const policy = await getEffectivePolicy(employee.companyId, employee.id, "certifications", employee);
    const rules = { ...DEFAULT_CERTIFICATION_RULES, ...(policy?.rules || {}) };
    const warningDays: number[] = rules.warningThresholdsDays || DEFAULT_CERTIFICATION_RULES.warningThresholdsDays;
    const { status, daysUntil } = classifyCertStatus(cert.expirationDate, warningDays);

    if (status === "valid") continue;

    if (status === "expiring_soon") {
      const tier = await pickNextUntriggeredThreshold(cert.id, daysUntil ?? 0, warningDays);
      if (tier === null) continue;

      const tierMessage = tier === 0
        ? `Certification expires today: ${cert.name}`
        : `Certification expiring within ${tier} days: ${cert.name}`;
      alerts.push({
        type: "certification_expiring",
        severity: tier <= 7 ? "critical" : tier <= 30 ? "high" : "medium",
        employeeId: cert.employeeId,
        message: tierMessage,
        details: {
          certificationId: cert.id,
          certificationName: cert.name,
          issuer: cert.issuer,
          expirationDate: cert.expirationDate,
          daysUntilExpiration: daysUntil,
          warningThreshold: tier,
          policyName: policy?.policyName || "Default",
        },
      });
    } else if (status === "expired") {
      await resolveOpenCertExpiringAlerts(cert.id);

      const expiredEnabled: boolean = rules.expiredAlertEnabled ?? DEFAULT_CERTIFICATION_RULES.expiredAlertEnabled;
      if (!expiredEnabled) continue;

      const reEmitDays: number = rules.expiredReminderEveryDays ?? DEFAULT_CERTIFICATION_RULES.expiredReminderEveryDays;
      const existing = await findExistingCertAlert(cert.employeeId, cert.id, "certification_expired");
      const reminderIntervalMs = reEmitDays * 24 * 60 * 60 * 1000;
      let reminderStamp: string | null = null;
      if (existing) {
        const lastEventAt = existing.status === "resolved" && existing.resolvedAt
          ? new Date(existing.resolvedAt).getTime()
          : existing.createdAt
            ? new Date(existing.createdAt).getTime()
            : 0;
        const since = Date.now() - lastEventAt;
        if (since < reminderIntervalMs) continue;
        if (existing.status !== "resolved") {
          // Auto-resolve prior open expired alert so only ONE rolling
          // expired alert exists per cert at any time (reminder cadence
          // preserved via reminderStamp + details.reminder).
          await db
            .update(systemAlerts)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
            })
            .where(eq(systemAlerts.id, existing.id));
          reminderStamp = todayStr();
        }
      }

      const baseMessage = `Certification expired: ${cert.name} on ${cert.expirationDate}`;
      const message = reminderStamp
        ? `${baseMessage} (reminder ${reminderStamp})`
        : baseMessage;
      alerts.push({
        type: "certification_expired",
        severity: "critical",
        employeeId: cert.employeeId,
        message,
        details: {
          certificationId: cert.id,
          certificationName: cert.name,
          issuer: cert.issuer,
          expirationDate: cert.expirationDate,
          expiredDays: Math.abs(daysUntil ?? 0),
          policyName: policy?.policyName || "Default",
          reminder: !!reminderStamp,
          reminderDate: reminderStamp,
        },
      });
    }
  }

  return alerts;
}

export async function resolveMissingDocumentAlertsFor(
  employeeId: string,
  documentType: string,
  resolverId: string,
): Promise<number> {
  const open = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.type, "missing_document"),
        eq(systemAlerts.employeeId, employeeId),
        sql`${systemAlerts.details}->>'documentType' = ${documentType}`,
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    );

  for (const alert of open) {
    await storage.updateSystemAlert(alert.id, {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: resolverId,
    });
  }
  return open.length;
}

export async function resolveCertificationAlertsFor(
  certificationId: string,
  resolverId: string,
): Promise<number> {
  const open = await db
    .select()
    .from(systemAlerts)
    .where(
      and(
        inArray(systemAlerts.type, ["certification_expiring", "certification_expired"]),
        sql`${systemAlerts.details}->>'certificationId' = ${certificationId}`,
        sql`${systemAlerts.status} <> 'resolved'`,
      ),
    );

  for (const alert of open) {
    await storage.updateSystemAlert(alert.id, {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: resolverId,
    });
  }
  return open.length;
}

// ===== Onboarding / Offboarding lifecycle alerts (Task #89) =====
// STALL_DAYS aligned with Phase 3 architecture §3 line 386 (30 days).
const STALL_DAYS = 30;

function daysBetweenDates(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export async function detectOnboardingOverdue(now: Date = new Date()): Promise<PolicyAlert[]> {
  const checklists = await storage.listOnboardingChecklists({ status: "in_progress" });
  const alerts: PolicyAlert[] = [];
  for (const cl of checklists) {
    const tasks = await storage.getOnboardingTasks(cl.id);
    const overdue = tasks.filter(t => {
      if (t.status === "completed" || t.status === "skipped") return false;
      if (!t.dueDate) return false;
      return new Date(t.dueDate) < now;
    });
    if (overdue.length > 0) {
      alerts.push({
        type: "onboarding_overdue",
        severity: "medium",
        employeeId: cl.employeeId,
        message: `Onboarding has ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}`,
        details: { checklistId: cl.id, overdueCount: overdue.length },
      });
    }
  }
  return alerts;
}

export async function detectOnboardingStalled(now: Date = new Date()): Promise<PolicyAlert[]> {
  const checklists = await storage.listOnboardingChecklists({ status: "in_progress" });
  const alerts: PolicyAlert[] = [];
  for (const cl of checklists) {
    const tasks = await storage.getOnboardingTasks(cl.id);
    const lastActivity = tasks.reduce<Date>((acc, t) => {
      const cand = t.completedAt ?? t.updatedAt;
      const d = cand ? new Date(cand) : null;
      if (d && d > acc) return d;
      return acc;
    }, cl.startedAt ? new Date(cl.startedAt) : new Date(0));
    if (daysBetweenDates(now, lastActivity) >= STALL_DAYS) {
      alerts.push({
        type: "onboarding_stalled",
        severity: "low",
        employeeId: cl.employeeId,
        message: `Onboarding has had no activity in ${STALL_DAYS}+ days`,
        details: { checklistId: cl.id, lastActivity: lastActivity.toISOString() },
      });
    }
  }
  return alerts;
}

export async function detectOffboardingOverdue(now: Date = new Date()): Promise<PolicyAlert[]> {
  const checklists = await storage.listOffboardingChecklists({ status: "in_progress" });
  const alerts: PolicyAlert[] = [];
  for (const cl of checklists) {
    const tasks = await storage.getOffboardingTasks(cl.id);
    const overdue = tasks.filter(t => {
      if (t.status === "completed" || t.status === "skipped") return false;
      if (!t.dueDate) return false;
      return new Date(t.dueDate) < now;
    });
    if (overdue.length > 0) {
      alerts.push({
        type: "offboarding_overdue",
        severity: "medium",
        employeeId: cl.employeeId,
        message: `Offboarding has ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}`,
        details: { checklistId: cl.id, overdueCount: overdue.length },
      });
    }
  }
  return alerts;
}

export async function detectOffboardingBlockingTermination(now: Date = new Date()): Promise<PolicyAlert[]> {
  const checklists = await storage.listOffboardingChecklists({ status: "in_progress" });
  const alerts: PolicyAlert[] = [];
  for (const cl of checklists) {
    if (!cl.terminationDate) continue;
    const termDate = new Date(cl.terminationDate);
    if (termDate > now) continue;
    const tasks = await storage.getOffboardingTasks(cl.id);
    const blocking = tasks.filter(t => t.blocksDeactivation && t.status !== "completed" && t.status !== "skipped");
    if (blocking.length > 0) {
      alerts.push({
        type: "offboarding_blocking_termination",
        severity: "high",
        employeeId: cl.employeeId,
        message: `Termination date passed but ${blocking.length} blocking task${blocking.length === 1 ? "" : "s"} remain`,
        details: { checklistId: cl.id, blockingTasks: blocking.map(b => b.title), terminationDate: cl.terminationDate },
      });
    }
  }
  return alerts;
}

export async function runLifecycleAlertDetection(now: Date = new Date()): Promise<void> {
  const all: PolicyAlert[] = [];
  try { all.push(...(await detectOnboardingOverdue(now))); } catch (e) { console.error("lifecycleAlerts.onboardingOverdue:", e); }
  try { all.push(...(await detectOnboardingStalled(now))); } catch (e) { console.error("lifecycleAlerts.onboardingStalled:", e); }
  try { all.push(...(await detectOffboardingOverdue(now))); } catch (e) { console.error("lifecycleAlerts.offboardingOverdue:", e); }
  try { all.push(...(await detectOffboardingBlockingTermination(now))); } catch (e) { console.error("lifecycleAlerts.offboardingBlocking:", e); }
  if (all.length > 0) await createPolicyAlerts(all);
}
