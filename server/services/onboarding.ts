import { storage } from "../storage";
import type {
  OnboardingChecklist,
  OnboardingTemplate,
  OnboardingTemplateTask,
  User,
  DueRule,
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

function resolveDueRule(
  rule: DueRule | null | undefined,
  legacyOffsetDays: number,
  anchors: { hireDate: Date | null; startDate: Date | null; terminationDate: Date | null },
): string | null {
  const r = rule ?? { kind: "relative", days: legacyOffsetDays } as DueRule;
  if (r.kind === "none") return null;
  if (r.kind === "absolute") return r.date;
  if (r.kind === "relative") {
    const anchor = r.anchor ?? "hire_date";
    const base = anchor === "termination_date" ? anchors.terminationDate
      : anchor === "start_date" ? anchors.startDate
      : anchors.hireDate;
    if (!base) return null;
    return addDays(base, r.days);
  }
  return null;
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
      const employeeCompanyId = employee.companyId ?? null;
      const templateCompanyId = t.companyId ?? null;
      if (templateCompanyId !== null && templateCompanyId !== employeeCompanyId) {
        // fall through
      } else {
        return t;
      }
    }
  }
  // Try scope-matched suggestion first
  try {
    const suggestions = await storage.suggestOnboardingTemplatesForEmployee(employee);
    if (suggestions.length > 0 && suggestions[0].matchScore >= 2) return suggestions[0];
  } catch {}
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

  const [tasks, sections] = await Promise.all([
    storage.getOnboardingTemplateTasks(template.id),
    storage.getOnboardingTemplateSections(template.id),
  ]);
  const sectionMap = new Map(sections.map(s => [s.id, s]));
  const hireDate = opts.hireDate ?? null;
  const hireBase = hireDate ? new Date(hireDate) : null;
  const anchors = { hireDate: hireBase, startDate: hireBase, terminationDate: null };

  const checklist = await storage.createOnboardingChecklistRow({
    employeeId: employee.id,
    templateId: template.id,
    hireDate,
    startedBy: opts.startedBy,
    status: "in_progress",
  });

  const now = new Date();
  // First pass: insert tasks with non-end_of_section dates
  const sectionMaxDate = new Map<string | null, string | null>();
  const insertedRows: Array<{ row: any; task: OnboardingTemplateTask }> = [];
  for (const t of tasks) {
    const auto = isSystemAutoTask(t);
    const section = t.sectionId ? sectionMap.get(t.sectionId) : null;
    const rule = (t.dueRule ?? null) as DueRule | null;
    let dueDate: string | null = null;
    if (rule?.kind !== "end_of_section") {
      dueDate = resolveDueRule(rule, t.dueOffsetDays, anchors);
    }
    const created = await storage.createOnboardingTaskRow({
      checklistId: checklist.id,
      templateTaskId: t.id,
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
      customFields: t.customFields ?? null,
      dueDate,
      sortOrder: t.sortOrder,
      status: auto ? "completed" : "pending",
      completedAt: auto ? now : null,
      completedBy: auto ? opts.startedBy : null,
      notes: auto ? "Auto-completed by system" : null,
    } as any);
    insertedRows.push({ row: created, task: t });
    if (dueDate) {
      const cur = sectionMaxDate.get(t.sectionId ?? null);
      if (!cur || dueDate > cur) sectionMaxDate.set(t.sectionId ?? null, dueDate);
    }
  }
  // Second pass: resolve end_of_section dates
  for (const { row, task } of insertedRows) {
    const rule = (task.dueRule ?? null) as DueRule | null;
    if (rule?.kind !== "end_of_section") continue;
    const maxDate = sectionMaxDate.get(task.sectionId ?? null) ?? null;
    if (!maxDate) continue;
    const due = rule.days ? addDays(new Date(maxDate), rule.days) : maxDate;
    await storage.updateOnboardingTask(row.id, { } as any);
    // dueDate isn't in updateOnboardingTask signature; use direct update via storage method extension
    // Workaround: re-create using raw update path
    try {
      const { db } = await import("../db");
      const { onboardingTasks } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(onboardingTasks).set({ dueDate: due }).where(eq(onboardingTasks.id, row.id));
    } catch {}
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
