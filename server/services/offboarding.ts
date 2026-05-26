import { storage } from "../storage";
import type {
  OffboardingChecklist,
  OffboardingTemplate,
  OffboardingTemplateTask,
  User,
  DueRule,
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

function resolveDueRule(
  rule: DueRule | null | undefined,
  legacyOffsetDays: number,
  anchors: { hireDate: Date | null; startDate: Date | null; terminationDate: Date | null },
): string | null {
  const r = rule ?? { kind: "relative", days: legacyOffsetDays, anchor: "termination_date" } as DueRule;
  if (r.kind === "none") return null;
  if (r.kind === "absolute") return r.date;
  if (r.kind === "relative") {
    const anchor = r.anchor ?? "termination_date";
    const base = anchor === "termination_date" ? anchors.terminationDate
      : anchor === "start_date" ? anchors.startDate
      : anchors.hireDate;
    if (!base) return null;
    return addDays(base, r.days);
  }
  return null;
}

export async function selectOffboardingTemplate(
  employee: User,
  explicitTemplateId?: string | null,
): Promise<OffboardingTemplate | undefined> {
  if (explicitTemplateId) {
    const t = await storage.getOffboardingTemplate(explicitTemplateId);
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
  try {
    const suggestions = await storage.suggestOffboardingTemplatesForEmployee(employee);
    if (suggestions.length > 0 && suggestions[0].matchScore >= 2) return suggestions[0];
  } catch {}
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
  const termBase = new Date(terminationDate);
  const anchors = { hireDate: null, startDate: null, terminationDate: termBase };

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

  const [tasks, sections] = await Promise.all([
    storage.getOffboardingTemplateTasks(template.id),
    storage.getOffboardingTemplateSections(template.id),
  ]);
  const sectionMap = new Map(sections.map(s => [s.id, s]));

  const checklist = await storage.createOffboardingChecklistRow({
    employeeId: employee.id,
    templateId: template.id,
    terminationDate,
    startedBy: opts.startedBy,
    status: "in_progress",
  });

  const sectionMaxDate = new Map<string | null, string | null>();
  const insertedRows: Array<{ row: any; task: OffboardingTemplateTask }> = [];
  for (const t of tasks) {
    const section = t.sectionId ? sectionMap.get(t.sectionId) : null;
    const rule = (t.dueRule ?? null) as DueRule | null;
    let dueDate: string | null = null;
    if (rule?.kind !== "end_of_section") {
      dueDate = resolveDueRule(rule, t.dueOffsetDays, anchors);
    }
    const created = await storage.createOffboardingTaskRow({
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
      blocksDeactivation: t.blocksDeactivation,
      linkUrl: t.linkUrl ?? null,
      customFields: t.customFields ?? null,
      dueDate,
      sortOrder: t.sortOrder,
      status: "pending",
    } as any);
    insertedRows.push({ row: created, task: t });
    if (dueDate) {
      const cur = sectionMaxDate.get(t.sectionId ?? null);
      if (!cur || dueDate > cur) sectionMaxDate.set(t.sectionId ?? null, dueDate);
    }
  }
  for (const { row, task } of insertedRows) {
    const rule = (task.dueRule ?? null) as DueRule | null;
    if (rule?.kind !== "end_of_section") continue;
    const maxDate = sectionMaxDate.get(task.sectionId ?? null) ?? null;
    if (!maxDate) continue;
    const due = rule.days ? addDays(new Date(maxDate), rule.days) : maxDate;
    try {
      const { db } = await import("../db");
      const { offboardingTasks } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(offboardingTasks).set({ dueDate: due }).where(eq(offboardingTasks.id, row.id));
    } catch {}
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
  const blocking = tasks
    .filter(t => (t.isRequired || t.blocksDeactivation) && t.status !== "completed" && t.status !== "skipped")
    .map(t => ({ id: t.id, title: t.title }));
  return { ok: blocking.length === 0, blocking };
}
