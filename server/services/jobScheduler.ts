/**
 * In-process background job runner.
 *
 * The job queue (server/services/jobs.ts) is drained by `/internal/jobs/run`
 * (an external cron) and the admin "Run jobs" button — but a deployment without
 * an external scheduler would never run the RECURRING jobs on its own. That left
 * the max-shift / missing-punch safeguard (`auto-clock-out` → runAutoClockOut)
 * dependent on a cron that isn't always configured, so a forgotten punch-out
 * could sit "in progress" indefinitely instead of being auto-marked a missing
 * punch.
 *
 * This starts a lightweight in-process timer that periodically enqueues the due
 * recurring jobs and drains the queue, so the safeguards run automatically with
 * no external moving parts. It is idempotent and concurrency-safe with an
 * external cron (jobs are claimed atomically; `ensureRecurringEnqueued` only
 * enqueues when nothing is pending), and can be turned off with
 * JOBS_IN_PROCESS_RUNNER=off when a dedicated scheduler owns the queue.
 */
import { config } from "../config";
import { logger } from "../lib/logger";
import { ensureRecurringEnqueued, drainPending } from "./jobs";

// Don't hammer the DB: never tick faster than once a minute regardless of env.
const MIN_INTERVAL_MS = 60_000;
// Let the server finish booting and serving before the first sweep.
const INITIAL_DELAY_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  // Skip if the previous sweep is still in flight (a slow drain shouldn't stack).
  if (running) return;
  running = true;
  try {
    await ensureRecurringEnqueued();
    const result = await drainPending(config.jobsBatchSize);
    if (result.processed > 0 || result.failed > 0 || result.reclaimed > 0) {
      logger.info("Background jobs swept", { source: "job-scheduler", ...result });
    }
  } catch (err) {
    logger.warn("Background job sweep failed", { source: "job-scheduler", err });
  } finally {
    running = false;
  }
}

/**
 * Start the in-process job runner. No-op when disabled via config or in tests.
 * Returns a stop function (used by tests / graceful shutdown).
 */
export function startJobScheduler(): () => void {
  if (!config.jobsRunnerEnabled || config.nodeEnv === "test") {
    return () => {};
  }
  if (timer) return stopJobScheduler;

  const intervalMs = Math.max(MIN_INTERVAL_MS, config.jobsRunnerIntervalMs);

  const initial = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    // Don't keep the event loop alive just for the timer.
    if (typeof timer.unref === "function") timer.unref();
  }, INITIAL_DELAY_MS);
  if (typeof initial.unref === "function") initial.unref();

  logger.info("In-process job scheduler started", {
    source: "job-scheduler",
    intervalMs,
  });
  return stopJobScheduler;
}

export function stopJobScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
