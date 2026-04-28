import { db } from "../db";
import { storage } from "../storage";
import { writeAuditLog } from "./audit";
import { employeeSchedules, userEmploymentProfiles } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

export type ApplyMode = "replace" | "merge";

export interface ApplyTemplateOptions {
  templateId: string;
  employeeIds: string[];
  mode: ApplyMode;
  actorUserId: string;
}

export interface ApplyTemplateResult {
  templateId: string;
  applied: number;
  skipped: Array<{ employeeId: string; reason: string }>;
  mode: ApplyMode;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateTemplateDays(days: Array<{ dayOfWeek: number; isWorkDay: boolean; startTime: string; endTime: string }>): { ok: true } | { ok: false; error: string } {
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6) {
      return { ok: false, error: `Invalid dayOfWeek: ${d.dayOfWeek}` };
    }
    if (seen.has(d.dayOfWeek)) {
      return { ok: false, error: `Duplicate dayOfWeek: ${d.dayOfWeek}` };
    }
    seen.add(d.dayOfWeek);
    if (!TIME_RE.test(d.startTime)) return { ok: false, error: `Invalid startTime for day ${d.dayOfWeek}` };
    if (!TIME_RE.test(d.endTime)) return { ok: false, error: `Invalid endTime for day ${d.dayOfWeek}` };
    if (d.isWorkDay && d.startTime >= d.endTime) {
      return { ok: false, error: `startTime must be before endTime for day ${d.dayOfWeek}` };
    }
  }
  return { ok: true };
}

export async function applyScheduleTemplate(opts: ApplyTemplateOptions): Promise<ApplyTemplateResult> {
  const { templateId, employeeIds, mode, actorUserId } = opts;

  const template = await storage.getScheduleTemplate(templateId);
  if (!template) {
    throw new Error("Template not found");
  }
  const days = await storage.getScheduleTemplateDays(templateId);

  const skipped: Array<{ employeeId: string; reason: string }> = [];
  let applied = 0;

  const eligibleProfiles = await db.select({ userId: userEmploymentProfiles.userId, terminationDate: userEmploymentProfiles.terminationDate })
    .from(userEmploymentProfiles)
    .where(inArray(userEmploymentProfiles.userId, employeeIds));
  const profileMap = new Map(eligibleProfiles.map(p => [p.userId, p]));

  for (const employeeId of employeeIds) {
    const prof = profileMap.get(employeeId);
    if (prof && prof.terminationDate) {
      const term = new Date(prof.terminationDate as unknown as string);
      if (!Number.isNaN(term.getTime()) && term <= new Date()) {
        skipped.push({ employeeId, reason: "inactive_employee" });
        continue;
      }
    }
    try {
      if (mode === "replace") {
        await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, employeeId));
        for (const d of days) {
          if (!d.isWorkDay) continue;
          await db.insert(employeeSchedules).values({
            employeeId,
            dayOfWeek: d.dayOfWeek,
            startTime: d.startTime,
            endTime: d.endTime,
            isActive: true,
            scheduleTemplateId: templateId,
          });
        }
      } else {
        for (const d of days) {
          if (d.isWorkDay) {
            await storage.upsertEmployeeSchedule({
              employeeId,
              dayOfWeek: d.dayOfWeek,
              startTime: d.startTime,
              endTime: d.endTime,
              isActive: true,
              scheduleTemplateId: templateId,
            });
          } else {
            await db.delete(employeeSchedules).where(
              and(eq(employeeSchedules.employeeId, employeeId), eq(employeeSchedules.dayOfWeek, d.dayOfWeek))
            );
          }
        }
      }
      applied++;
      await writeAuditLog({
        actorUserId,
        targetType: "employee_schedule",
        targetId: employeeId,
        action: "schedule.template_applied",
        newValue: { templateId, templateName: template.name, mode },
        context: { templateId, mode },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "apply_failed";
      skipped.push({ employeeId, reason });
    }
  }

  return { templateId, applied, skipped, mode };
}
