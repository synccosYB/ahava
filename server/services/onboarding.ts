import { storage } from "../storage";
import type {
  OnboardingChecklist,
  OnboardingTemplate,
  OnboardingTemplateTask,
  User,
} from "@shared/schema";
import { writeAuditLog } from "./audit";
import { createPolicyAlert } from "./policyEnforcement";

const SYSTEM_AUTO_TITLES = new Set([
  "Issue temporary password",
  "Create account",
  "Send welcome email",
]);

function isSystemAutoTask(t: OnboardingTemplateTask): boolean {
  if (t.ownerRole === "system") return true;
  if (SYSTEM_AUTO_TITLES.has(t.title)) return true;
  return false;
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface MaterializeOptions {
  templateId?: string | null;
  hireDate?: string | null;
  startedBy: string;
  context?: { actorUserId?: string; ip?: string | null; userAgent?: string | null } | null;
}

export async function selectOnboardingTemplate(
  employee: User,
  explicitTemplateId?: string | null,
): Promise<OnboardingTemplate | undefined> {
  if (explicitTemplateId) {
    const t = await storage.getOnboardingTemplate(explicitTemplateId);
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
  const def = await storage.getDefaultOnboardingTemplate(employee.companyId ?? null);
  if (def) return def;
  const all = await storage.getOnboardingTemplates({ companyId: employee.companyId ?? null, isActive: true });
  return all[0];
}

export async function materializeOnboardingChecklist(
  employee: User,
  opts: MaterializeOptions,
): Promise<OnboardingChecklist | null> {
  const existing = await storage.getOnboardingChecklistByEmployee(employee.id);
  if (existing && existing.status === "in_progress") return existing;

  const template = await selectOnboardingTemplate(employee, opts.templateId ?? null);

  if (!template) {
    await createPolicyAlert({
      type: "onboarding_no_template",
      severity: "medium",
      employeeId: employee.id,
      message: `No onboarding template available for ${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
      details: { companyId: employee.companyId },
    });
    return null;
  }

  const tasks = await storage.getOnboardingTemplateTasks(template.id);
  const hireDate = opts.hireDate ?? null;
  const baseDate = hireDate ? new Date(hireDate) : null;

  const checklist = await storage.createOnboardingChecklistRow({
    employeeId: employee.id,
    templateId: template.id,
    hireDate,
    startedBy: opts.startedBy,
    status: "in_progress",
  });

  const now = new Date();
  for (const t of tasks) {
    const auto = isSystemAutoTask(t);
    await storage.createOnboardingTaskRow({
      checklistId: checklist.id,
      templateTaskId: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      ownerRole: t.ownerRole,
      isRequired: t.isRequired,
      documentType: t.documentType,
      // Per arch §3: due dates are only computed when a hireDate exists.
      // Without a hireDate, we leave dueDate null so reminders are not
      // anchored to an arbitrary "today" baseline.
      dueDate: baseDate ? addDays(baseDate, t.dueOffsetDays) : null,
      sortOrder: t.sortOrder,
      status: auto ? "completed" : "pending",
      completedAt: auto ? now : null,
      completedBy: auto ? opts.startedBy : null,
      notes: auto ? "Auto-completed by system" : null,
    });
  }

  await writeAuditLog({
    action: "onboarding.materialize",
    actorUserId: opts.startedBy,
    targetType: "user",
    targetId: employee.id,
    newValue: { checklistId: checklist.id, templateId: template.id, taskCount: tasks.length },
    ipAddress: opts.context?.ip ?? undefined,
    userAgent: opts.context?.userAgent ?? undefined,
  });

  const completed = await storage.completeOnboardingChecklistIfFinished(checklist.id);
  if (completed) {
    await writeAuditLog({
      action: "onboarding.complete",
      actorUserId: opts.startedBy,
      targetType: "onboarding_checklist",
      targetId: checklist.id,
      newValue: { employeeId: employee.id, trigger: "materialize_auto" },
      ipAddress: opts.context?.ip ?? undefined,
      userAgent: opts.context?.userAgent ?? undefined,
    });
  }

  return checklist;
}

export async function autoCompleteDocumentTask(
  employeeId: string,
  documentType: string,
  documentId: string,
  actorUserId: string,
): Promise<void> {
  const checklist = await storage.getOnboardingChecklistByEmployee(employeeId);
  if (!checklist || checklist.status !== "in_progress") return;
  const tasks = await storage.getOnboardingTasks(checklist.id);
  const match = tasks.find(t => t.documentType === documentType && t.status !== "completed" && t.status !== "skipped");
  if (!match) return;
  await storage.updateOnboardingTask(match.id, {
    status: "completed",
    completedAt: new Date(),
    completedBy: actorUserId,
    documentId,
  });
  const completed = await storage.completeOnboardingChecklistIfFinished(checklist.id);
  await writeAuditLog({
    action: "onboarding.task.auto_complete",
    actorUserId,
    targetType: "onboarding_task",
    targetId: match.id,
    newValue: { documentType, documentId, checklistId: checklist.id },
  });
  if (completed) {
    await writeAuditLog({
      action: "onboarding.complete",
      actorUserId,
      targetType: "onboarding_checklist",
      targetId: checklist.id,
      newValue: { employeeId, trigger: "document_auto_complete" },
    });
  }
}
