ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_status" (
  "type" varchar(64) PRIMARY KEY,
  "last_run_at" timestamp,
  "last_success_at" timestamp,
  "last_failure_at" timestamp,
  "last_error" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "total_runs" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
