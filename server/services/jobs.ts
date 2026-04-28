import { db } from "../db";
import { jobs, type Job, type InsertJob } from "@shared/schema";
import { and, eq, asc, gte, inArray, desc } from "drizzle-orm";
import { runAutoClockOut, createPolicyAlerts } from "./policyEnforcement";
import { applyPtoAnniversaryAdjustments } from "./ptoAnniversary";
import { evaluatePerformanceReviews } from "./performanceReviews";
import { reevaluateAllUsers } from "./roleAssignment";
import { applyScheduleTemplate, type ApplyMode } from "./scheduleTemplates";
import {
  detectMissingDocuments,
  detectExpiringCertifications,
  syncCertificationStatuses,
} from "./lifecycleAlerts";
import type { GeneratedAlert } from "./alerts";
import { runBiometricRetention } from "./biometricRetention";

export type JobType =
  | "auto-clock-out"
  | "rebuild-report"
  | "apply-pto-anniversary-adjustments"
  | "evaluate-performance-reviews"
  | "re-evaluate-role-assignments"
  | "apply-schedule-template"
  | "evaluate-missing-documents"
  | "evaluate-expiring-certifications"
  | "biometric-retention";

const DAILY_RECURRING_HOURS = 24;

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
    case "biometric-retention": {
      await runBiometricRetention();
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
    case "evaluate-missing-documents": {
      const alerts: GeneratedAlert[] = await detectMissingDocuments();
      if (alerts.length > 0) {
        await createPolicyAlerts(alerts);
      }
      return;
    }
    case "evaluate-expiring-certifications": {
      await syncCertificationStatuses();
      const alerts: GeneratedAlert[] = await detectExpiringCertifications();
      if (alerts.length > 0) {
        await createPolicyAlerts(alerts);
      }
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
    } catch (err: unknown) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(jobs)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      console.error(`Job ${job.id} (${job.type}) failed:`, err);
    }
  }

  return { processed, failed };
}

const ROLE_REEVAL_INTERVAL_MINUTES = 60;

async function shouldEnqueueRecurring(type: JobType, minHoursBetween: number): Promise<boolean> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ["pending", "running"])))
    .limit(1);
  if (pending.length > 0) return false;

  const cutoff = new Date(Date.now() - minHoursBetween * 60 * 60 * 1000);
  const recent = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), gte(jobs.createdAt, cutoff)))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return recent.length === 0;
}

export async function ensureRecurringEnqueued(): Promise<void> {
  const recurring: JobType[] = [
    "auto-clock-out",
    "apply-pto-anniversary-adjustments",
    "evaluate-performance-reviews",
    "biometric-retention",
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

  const recurringHr: JobType[] = ["evaluate-missing-documents", "evaluate-expiring-certifications"];
  for (const t of recurringHr) {
    if (await shouldEnqueueRecurring(t, DAILY_RECURRING_HOURS)) {
      await enqueue(t);
    }
  }
}
