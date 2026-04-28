CREATE TABLE IF NOT EXISTS "pto_anniversary_adjustments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "effective_date" date NOT NULL,
  "old_accrual_rate" real,
  "new_accrual_rate" real NOT NULL,
  "old_tier_label" varchar(100),
  "new_tier_label" varchar(100),
  "years_of_service" integer NOT NULL,
  "hours_added" real NOT NULL,
  "pto_policy_id" varchar REFERENCES "pto_policies"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pto_anniversary_adjustments_employee_effective_unique"
    UNIQUE ("employee_id", "effective_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pto_anniversary_adjustments_employee_idx"
  ON "pto_anniversary_adjustments" ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_review_cycles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar REFERENCES "companies"("id"),
  "name" varchar(200) NOT NULL,
  "cadence" varchar(30) NOT NULL,
  "anchor" varchar(30) NOT NULL,
  "lead_times" jsonb NOT NULL DEFAULT '[14,7,0]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_review_reminders" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "cycle_id" varchar NOT NULL REFERENCES "performance_review_cycles"("id"),
  "due_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "completed_by" varchar REFERENCES "users"("id"),
  "completed_at" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "performance_review_reminders_employee_cycle_due_unique"
    UNIQUE ("employee_id", "cycle_id", "due_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_review_reminders_employee_status_idx"
  ON "performance_review_reminders" ("employee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_review_reminders_due_status_idx"
  ON "performance_review_reminders" ("due_date", "status");
