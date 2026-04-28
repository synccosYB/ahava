import { storage } from "../storage";
import type {
  OffboardingChecklist,
  OffboardingTemplate,
  User,
} from "@shared/schema";
import { writeAuditLog } from "./audit";
import { createPolicyAlert } from "./policyEnforcement";

export interface MaterializeOffboardingOptions {
  templateId?: string | null;
  terminationDate?: string | null;
  startedBy: string;
  context?: { ip?: string | null; userAgent?: string | null } | null;
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function selectOffboardingTemplate(
  employee: User,
  explicitTemplateId?: string | null,
): Promise<OffboardingTemplate | undefined> {
  if (explicitTemplateId) {
    const t = await storage.getOffboardingTemplate(explicitTemplateId);
    if (t && t.isActive) {
      // Scope check: template must be global (companyId=null) or belong to the employee's company.
      const employeeCompanyId = employee.companyId ?? null;
      const templateCompanyId = t.companyId ?? null;
      if (templateCompanyId !== null && templateCompanyId !== employeeCompanyId) {
        // Reject cross-company template selection silently and fall through to default.
      } else {
        return t;
      }
    }
  }
  const def = await storage.getDefaultOffboardingTemplate(employee.companyId ?? null);
  if (def) return def;
  const all = await storage.getOffboardingTemplates({ companyId: employee.companyId ?? null, isActive: true });
  return all[0];
}

export async function materializeOffboardingChecklist(
  employee: User,
  opts: MaterializeOffboardingOptions,
): Promise<OffboardingChecklist | null> {
  const existing = await storage.getOffboardingChecklistByEmployee(employee.id);
  if (existing && existing.status === "in_progress") return existing;

  const template = await selectOffboardingTemplate(employee, opts.templateId ?? null);
  const terminationDate = opts.terminationDate ?? new Date().toISOString().slice(0, 10);
  const baseDate = new Date(terminationDate);

  // Per Phase 3 architecture §4: when no template is found we still create
  // a zero-task checklist so the offboarding flow exists, and emit a
  // dedicated `offboarding_no_template` alert so admins can attend to it.
  if (!template) {
    const checklist = await storage.createOffboardingChecklistRow({
      employeeId: employee.id,
      templateId: null,
      terminationDate,
      startedBy: opts.startedBy,
      status: "in_progress",
    });
    await createPolicyAlert({
      type: "offboarding_no_template",
      severity: "low",
      employeeId: employee.id,
      message: `No offboarding template available for ${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
      details: { checklistId: checklist.id, companyId: employee.companyId },
    });
    await writeAuditLog({
      action: "offboarding.materialize",
      actorUserId: opts.startedBy,
      targetType: "user",
      targetId: employee.id,
      newValue: { checklistId: checklist.id, templateId: null, taskCount: 0, terminationDate, reason: "no_template" },
      ipAddress: opts.context?.ip ?? undefined,
      userAgent: opts.context?.userAgent ?? undefined,
    });
    return checklist;
  }

  const tasks = await storage.getOffboardingTemplateTasks(template.id);

  const checklist = await storage.createOffboardingChecklistRow({
    employeeId: employee.id,
    templateId: template.id,
    terminationDate,
    startedBy: opts.startedBy,
    status: "in_progress",
  });

  for (const t of tasks) {
    await storage.createOffboardingTaskRow({
      checklistId: checklist.id,
      templateTaskId: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      ownerRole: t.ownerRole,
      isRequired: t.isRequired,
      blocksDeactivation: t.blocksDeactivation,
      dueDate: addDays(baseDate, t.dueOffsetDays),
      sortOrder: t.sortOrder,
      status: "pending",
    });
  }

  await writeAuditLog({
    action: "offboarding.materialize",
    actorUserId: opts.startedBy,
    targetType: "user",
    targetId: employee.id,
    newValue: { checklistId: checklist.id, templateId: template.id, taskCount: tasks.length, terminationDate: opts.terminationDate ?? null },
    ipAddress: opts.context?.ip ?? undefined,
    userAgent: opts.context?.userAgent ?? undefined,
  });

  return checklist;
}

export interface DeactivationGate {
  ok: boolean;
  blocking: { id: string; title: string }[];
}

export async function evaluateDeactivationGate(checklistId: string): Promise<DeactivationGate> {
  const tasks = await storage.getOffboardingTasks(checklistId);
  // Block deactivation when any required task OR any explicitly-blocking task
  // is still incomplete (i.e. not completed and not skipped).
  const blocking = tasks
    .filter(t => (t.isRequired || t.blocksDeactivation) && t.status !== "completed" && t.status !== "skipped")
    .map(t => ({ id: t.id, title: t.title }));
  return { ok: blocking.length === 0, blocking };
}
