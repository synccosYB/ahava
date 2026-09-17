-- Weekly Punctuality Rate Bonus (Task: punctuality-bonus).
-- One row per (employee, pay-week) recording whether the employee earned the
-- configurable punctuality rate bonus for that week and, for the absence case,
-- the manager's review decision. See shared/schema.ts:punctualityBonusWeeks and
-- server/services/punctualityBonus.ts.
-- Additive and replay-safe (IF NOT EXISTS / information_schema-guarded throughout).
CREATE TABLE IF NOT EXISTS "punctuality_bonus_weeks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" varchar NOT NULL,
  "week_start_date" date NOT NULL,
  "status" varchar(20) NOT NULL,
  "reason" text,
  "bonus_per_hour" real NOT NULL DEFAULT 0,
  "regular_hours" real NOT NULL DEFAULT 0,
  "overtime_hours" real NOT NULL DEFAULT 0,
  "double_time_hours" real NOT NULL DEFAULT 0,
  "overtime_multiplier" real NOT NULL DEFAULT 1.5,
  "double_time_multiplier" real NOT NULL DEFAULT 2,
  "bonus_amount" real NOT NULL DEFAULT 0,
  "decided_by" varchar,
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'punctuality_bonus_weeks_employee_id_users_id_fk'
  ) THEN
    ALTER TABLE "punctuality_bonus_weeks"
      ADD CONSTRAINT "punctuality_bonus_weeks_employee_id_users_id_fk"
      FOREIGN KEY ("employee_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'punctuality_bonus_weeks_decided_by_users_id_fk'
  ) THEN
    ALTER TABLE "punctuality_bonus_weeks"
      ADD CONSTRAINT "punctuality_bonus_weeks_decided_by_users_id_fk"
      FOREIGN KEY ("decided_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "punctuality_bonus_weeks_employee_week_idx" ON "punctuality_bonus_weeks" ("employee_id", "week_start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punctuality_bonus_weeks_status_idx" ON "punctuality_bonus_weeks" ("status");
