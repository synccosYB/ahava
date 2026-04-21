CREATE TABLE IF NOT EXISTS "jobs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(64) NOT NULL,
  "payload" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_created_at_idx" ON "jobs" ("status", "created_at");
