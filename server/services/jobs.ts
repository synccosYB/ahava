import { db } from "../db";
import { jobs, jobStatus, type Job, type InsertJob, type JobStatus } from "@shared/schema";
import { and, eq, asc, gte, inArray, desc, lt, or, isNull, sql, count } from "drizzle-orm";
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

// Bounded retries: a failing job is re-queued up to MAX_ATTEMPTS times before it
// is parked in "failed". Each claim increments the job's attempts counter.
export const MAX_ATTEMPTS = Number(process.env.JOB_MAX_ATTEMPTS) || 3;

// Visibility timeout: a job left in "running" longer than this (e.g. the worker
// crashed mid-run) is reclaimable so it never gets stuck forever.
export const VISIBILITY_TIMEOUT_MS =
  (Number(process.env.JOB_VISIBILITY_TIMEOUT_MINUTES) || 15) * 60_000;

// Expected cadence (hours) per recurring job type. A job whose last successful
// run is older than this window (or that has never succeeded) is flagged stale
// in the admin health view. Non-recurring job types are omitted (no window).
const EXPECTED_WINDOW_HOURS: Partial<Record<JobType, number>> = {
  "auto-clock-out": 26,
  "apply-pto-anniversary-adjustments": 26,
  "evaluate-performance-reviews": 26,
  "biometric-retention": 26,
  "evaluate-missing-documents": 26,
  "evaluate-expiring-certifications": 26,
  "re-evaluate-role-assignments": 2,
};

const ALL_JOB_TYPES: JobType[] = [
  "auto-clock-out",
  "rebuild-report",
  "apply-pto-anniversary-adjustments",
  "evaluate-performance-reviews",
  "re-evaluate-role-assignments",
  "apply-schedule-template",
  "evaluate-missing-documents",
  "evaluate-expiring-certifications",
  "biometric-retention",
];

async function recordJobOutcome(
  type: string,
  outcome: "success" | "failure",
  errorMessage?: string | null,
): Promise<void> {
  const now = new Date();
  if (outcome === "success") {
    await db
      .insert(jobStatus)
      .values({
        type,
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
        retryCount: 0,
        consecutiveFailures: 0,
        totalRuns: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobStatus.type,
        set: {
          lastRunAt: now,
          lastSuccessAt: now,
          lastError: null,
          consecutiveFailures: 0,
          totalRuns: sql`${jobStatus.totalRuns} + 1`,
          updatedAt: now,
        },
      });
  } else {
    await db
      .insert(jobStatus)
      .values({
        type,
        lastRunAt: now,
        lastFailureAt: now,
        lastError: errorMessage ?? "Unknown error",
        retryCount: 1,
        consecutiveFailures: 1,
        totalRuns: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobStatus.type,
        set: {
          lastRunAt: now,
          lastFailureAt: now,
          lastError: errorMessage ?? "Unknown error",
          retryCount: sql`${jobStatus.retryCount} + 1`,
          consecutiveFailures: sql`${jobStatus.consecutiveFailures} + 1`,
          totalRuns: sql`${jobStatus.totalRuns} + 1`,
          updatedAt: now,
        },
      });
  }
}

/**
 * Reclaim jobs stuck in "running" past the visibility timeout (crashed worker).
 * Jobs with remaining attempts are returned to "pending" for retry; jobs that
 * have exhausted their attempts are parked in "failed". Returns the number of
 * reclaimed jobs.
 */
export async function reclaimStuckJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - VISIBILITY_TIMEOUT_MS);
  const stuck = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "running"),
        or(lt(jobs.startedAt, cutoff), and(isNull(jobs.startedAt), lt(jobs.createdAt, cutoff))),
      ),
    );

  let reclaimed = 0;
  for (const job of stuck) {
    const message = `Reclaimed after exceeding ${Math.round(
      VISIBILITY_TIMEOUT_MS / 60_000,
    )}m visibility timeout (worker presumed crashed)`;
    if (job.attempts >= MAX_ATTEMPTS) {
      await db
        .update(jobs)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
      console.error(`Job ${job.id} (${job.type}) ${message}; max attempts reached — parked as failed.`);
    } else {
      await db
        .update(jobs)
        .set({ status: "pending", startedAt: null, error: message })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
      console.warn(`Job ${job.id} (${job.type}) ${message}; re-queued for retry.`);
    }
    await recordJobOutcome(job.type, "failure", message);
    reclaimed += 1;
  }
  return reclaimed;
}

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

export async function drainPending(
  limit: number,
): Promise<{ processed: number; failed: number; retried: number; reclaimed: number }> {
  // Recover any jobs whose worker crashed mid-run before claiming new work.
  const reclaimed = await reclaimStuckJobs();

  const pending = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(asc(jobs.createdAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;
  let retried = 0;

  for (const job of pending) {
    const claimedRows = await db
      .update(jobs)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
      .returning();
    if (claimedRows.length === 0) continue;
    const claimed = claimedRows[0];

    try {
      await processJob(claimed);
      await db
        .update(jobs)
        .set({ status: "completed", completedAt: new Date(), error: null })
        .where(eq(jobs.id, claimed.id));
      await recordJobOutcome(claimed.type, "success");
      processed += 1;
    } catch (err: unknown) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = claimed.attempts >= MAX_ATTEMPTS;
      if (exhausted) {
        await db
          .update(jobs)
          .set({ status: "failed", error: message, completedAt: new Date() })
          .where(eq(jobs.id, claimed.id));
        console.error(
          `Job ${claimed.id} (${claimed.type}) failed after ${claimed.attempts} attempt(s) — parked as failed:`,
          message,
        );
      } else {
        // Re-queue for a bounded retry on the next drain.
        await db
          .update(jobs)
          .set({ status: "pending", startedAt: null, error: message })
          .where(eq(jobs.id, claimed.id));
        retried += 1;
        console.warn(
          `Job ${claimed.id} (${claimed.type}) failed (attempt ${claimed.attempts}/${MAX_ATTEMPTS}) — re-queued:`,
          message,
        );
      }
      await recordJobOutcome(claimed.type, "failure", message);
    }
  }

  return { processed, failed, retried, reclaimed };
}

export interface JobHealthEntry {
  type: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  retryCount: number;
  consecutiveFailures: number;
  totalRuns: number;
  pending: number;
  running: number;
  failed: number;
  expectedWindowHours: number | null;
  stale: boolean;
  health: "ok" | "stale" | "failing" | "never_run";
}

/**
 * Per-job-type health snapshot for the admin monitoring view. Combines the
 * persisted job_status aggregate with live counts of pending/running/failed
 * jobs, and flags any recurring job that has not succeeded within its expected
 * window.
 */
export async function getJobHealth(): Promise<JobHealthEntry[]> {
  const statusRows = await db.select().from(jobStatus);
  const statusByType = new Map<string, JobStatus>(statusRows.map((r) => [r.type, r]));

  const counts = await db
    .select({ type: jobs.type, status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.type, jobs.status);
  const countByType = new Map<string, { pending: number; running: number; failed: number }>();
  for (const row of counts) {
    const entry = countByType.get(row.type) ?? { pending: 0, running: 0, failed: 0 };
    if (row.status === "pending") entry.pending = Number(row.n);
    else if (row.status === "running") entry.running = Number(row.n);
    else if (row.status === "failed") entry.failed = Number(row.n);
    countByType.set(row.type, entry);
  }

  const types = new Set<string>([
    ...ALL_JOB_TYPES,
    ...statusByType.keys(),
    ...countByType.keys(),
  ]);

  const now = Date.now();
  const entries: JobHealthEntry[] = [];
  for (const type of types) {
    const status = statusByType.get(type);
    const c = countByType.get(type) ?? { pending: 0, running: 0, failed: 0 };
    const windowHours = EXPECTED_WINDOW_HOURS[type as JobType] ?? null;

    let stale = false;
    if (windowHours !== null) {
      if (!status?.lastSuccessAt) {
        stale = true;
      } else {
        const ageMs = now - status.lastSuccessAt.getTime();
        stale = ageMs > windowHours * 60 * 60 * 1000;
      }
    }

    let health: JobHealthEntry["health"];
    if (!status || !status.lastRunAt) {
      health = "never_run";
    } else if ((status.consecutiveFailures ?? 0) > 0 || c.failed > 0) {
      health = "failing";
    } else if (stale) {
      health = "stale";
    } else {
      health = "ok";
    }

    entries.push({
      type,
      lastRunAt: status?.lastRunAt ?? null,
      lastSuccessAt: status?.lastSuccessAt ?? null,
      lastFailureAt: status?.lastFailureAt ?? null,
      lastError: status?.lastError ?? null,
      retryCount: status?.retryCount ?? 0,
      consecutiveFailures: status?.consecutiveFailures ?? 0,
      totalRuns: status?.totalRuns ?? 0,
      pending: c.pending,
      running: c.running,
      failed: c.failed,
      expectedWindowHours: windowHours,
      stale,
      health,
    });
  }

  entries.sort((a, b) => a.type.localeCompare(b.type));
  return entries;
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
