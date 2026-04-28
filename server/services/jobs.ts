import { db } from "../db";
import { jobs, type Job, type InsertJob } from "@shared/schema";
import { and, eq, asc, desc } from "drizzle-orm";
import { runAutoClockOut, createPolicyAlerts } from "./policyEnforcement";
import { applyPtoAnniversaryAdjustments } from "./ptoAnniversary";
import { evaluatePerformanceReviews } from "./performanceReviews";
import { reevaluateAllUsers } from "./roleAssignment";
import { applyScheduleTemplate, type ApplyMode } from "./scheduleTemplates";

export type JobType =
  | "auto-clock-out"
  | "rebuild-report"
  | "apply-pto-anniversary-adjustments"
  | "evaluate-performance-reviews"
  | "re-evaluate-role-assignments"
  | "apply-schedule-template";

export async function enqueue(type: JobType, payload?: unknown): Promise<Job> {
  const [created] = await db
    .insert(jobs)
    .values({
      type,
      payload: (payload ?? null) as InsertJob["payload"],
      status: "pending",
    })
    .returning();
  return created;
}

async function processJob(job: Job): Promise<void> {
  switch (job.type as JobType) {
    case "auto-clock-out": {
      const alerts = await runAutoClockOut();
      if (alerts.length > 0) {
        await createPolicyAlerts(alerts);
      }
      return;
    }
    case "rebuild-report": {
      return;
    }
    case "apply-pto-anniversary-adjustments": {
      await applyPtoAnniversaryAdjustments();
      return;
    }
    case "evaluate-performance-reviews": {
      const alerts = await evaluatePerformanceReviews();
      if (alerts.length > 0) {
        await createPolicyAlerts(alerts);
      }
      return;
    }
    case "re-evaluate-role-assignments": {
      const payload = (job.payload || {}) as { actorUserId?: string; reason?: string };
      const actorUserId = payload.actorUserId || "system";
      const reason = payload.reason || "scheduled re-evaluation";
      await reevaluateAllUsers(actorUserId, reason);
      return;
    }
    case "apply-schedule-template": {
      const payload = (job.payload || {}) as { templateId?: string; employeeIds?: string[]; mode?: ApplyMode; actorUserId?: string };
      if (!payload.templateId || !Array.isArray(payload.employeeIds)) {
        throw new Error("apply-schedule-template requires templateId and employeeIds");
      }
      await applyScheduleTemplate({
        templateId: payload.templateId,
        employeeIds: payload.employeeIds,
        mode: payload.mode === "merge" ? "merge" : "replace",
        actorUserId: payload.actorUserId || "system",
      });
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

export async function drainPending(limit: number): Promise<{ processed: number; failed: number }> {
  const pending = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(asc(jobs.createdAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const job of pending) {
    const claimed = await db
      .update(jobs)
      .set({ status: "running" })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
      .returning();
    if (claimed.length === 0) continue;

    try {
      await processJob(job);
      await db
        .update(jobs)
        .set({ status: "completed", completedAt: new Date(), error: null })
        .where(eq(jobs.id, job.id));
      processed += 1;
    } catch (err: any) {
      failed += 1;
      await db
        .update(jobs)
        .set({
          status: "failed",
          error: String(err?.message || err),
          completedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      console.error(`Job ${job.id} (${job.type}) failed:`, err);
    }
  }

  return { processed, failed };
}

const ROLE_REEVAL_INTERVAL_MINUTES = 60;

export async function ensureRecurringEnqueued(): Promise<void> {
  const recurring: JobType[] = [
    "auto-clock-out",
    "apply-pto-anniversary-adjustments",
    "evaluate-performance-reviews",
  ];
  for (const type of recurring) {
    const existing = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, type), eq(jobs.status, "pending")))
      .limit(1);
    if (existing.length === 0) {
      await enqueue(type);
    }
  }

  // Recurring role re-evaluation runs at most once per
  // ROLE_REEVAL_INTERVAL_MINUTES (default 60). We only enqueue a new job when
  // there is no pending instance AND the most recent completed run is older
  // than that interval (or no run exists yet).
  const intervalMinutes = Number(process.env.ROLE_REEVAL_INTERVAL_MINUTES) || 60;
  const intervalAgo = new Date(Date.now() - intervalMinutes * 60_000);
  const existingReevalPending = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "re-evaluate-role-assignments"), eq(jobs.status, "pending")))
    .limit(1);
  if (existingReevalPending.length === 0) {
    const [lastCompleted] = await db
      .select({ completedAt: jobs.completedAt })
      .from(jobs)
      .where(and(eq(jobs.type, "re-evaluate-role-assignments"), eq(jobs.status, "completed")))
      .orderBy(desc(jobs.completedAt))
      .limit(1);
    const dueForRun = !lastCompleted?.completedAt || lastCompleted.completedAt < intervalAgo;
    if (dueForRun) {
      await enqueue("re-evaluate-role-assignments");
    }
  }
}
