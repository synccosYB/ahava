-- Sync DB with shared/schema.ts:
--   * attendance_exceptions.reopen_* columns (Task #231 / recovery for Task #237 —
--     existing environments that missed this migration crash on
--     /api/attendance/exceptions/pending with "column reopen_requested_by does not exist";
--     replaying this migration is safe and restores those endpoints).
--   * onboarding_templates / onboarding_template_tasks / onboarding_checklists
--     / onboarding_tasks tables
--   * offboarding_templates / offboarding_template_tasks /
--     offboarding_checklists / offboarding_tasks tables (also defined in
--     schema.ts but never migrated; included to keep drift from re-biting).
-- All statements are additive and use IF NOT EXISTS, so this is replay-safe.

ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_requested_by" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_requested_at" timestamp;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_message" text;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_decided_by" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_decided_at" timestamp;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_decision_note" text;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions"
  ADD COLUMN IF NOT EXISTS "reopen_consumed_at" timestamp;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar REFERENCES "companies"("id"),
  "name" varchar(200) NOT NULL,
  "description" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" varchar REFERENCES "users"("id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_template_tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "onboarding_templates"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "category" varchar(30) NOT NULL DEFAULT 'paperwork',
  "owner_role" varchar(30) NOT NULL DEFAULT 'hr',
  "is_required" boolean NOT NULL DEFAULT true,
  "document_type" varchar(50),
  "due_offset_days" integer NOT NULL DEFAULT 0,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_checklists" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "template_id" varchar REFERENCES "onboarding_templates"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'in_progress',
  "hire_date" date,
  "started_at" timestamp DEFAULT now(),
  "started_by" varchar REFERENCES "users"("id"),
  "completed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by" varchar REFERENCES "users"("id"),
  "cancel_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_checklists_employee"
  ON "onboarding_checklists" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_checklists_status"
  ON "onboarding_checklists" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_checklists_employee_status"
  ON "onboarding_checklists" ("employee_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_onb_checklist_employee_in_progress"
  ON "onboarding_checklists" ("employee_id")
  WHERE status = 'in_progress';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "checklist_id" varchar NOT NULL REFERENCES "onboarding_checklists"("id") ON DELETE CASCADE,
  "template_task_id" varchar REFERENCES "onboarding_template_tasks"("id"),
  "title" varchar(200) NOT NULL,
  "description" text,
  "category" varchar(30) NOT NULL DEFAULT 'paperwork',
  "owner_role" varchar(30) NOT NULL DEFAULT 'hr',
  "is_required" boolean NOT NULL DEFAULT true,
  "document_type" varchar(50),
  "due_date" date,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "notes" text,
  "skipped_reason" text,
  "document_id" varchar REFERENCES "documents"("id"),
  "completed_by" varchar REFERENCES "users"("id"),
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offboarding_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar REFERENCES "companies"("id"),
  "name" varchar(200) NOT NULL,
  "description" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" varchar REFERENCES "users"("id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offboarding_template_tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "offboarding_templates"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "category" varchar(30) NOT NULL DEFAULT 'access',
  "owner_role" varchar(30) NOT NULL DEFAULT 'hr',
  "is_required" boolean NOT NULL DEFAULT true,
  "blocks_deactivation" boolean NOT NULL DEFAULT false,
  "due_offset_days" integer NOT NULL DEFAULT 0,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offboarding_checklists" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "template_id" varchar REFERENCES "offboarding_templates"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'in_progress',
  "termination_date" date NOT NULL,
  "started_at" timestamp DEFAULT now(),
  "started_by" varchar REFERENCES "users"("id"),
  "completed_at" timestamp,
  "account_deactivated_at" timestamp,
  "account_deactivated_by" varchar REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_checklists_employee"
  ON "offboarding_checklists" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_checklists_status"
  ON "offboarding_checklists" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_checklists_employee_status"
  ON "offboarding_checklists" ("employee_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_off_checklist_employee_in_progress"
  ON "offboarding_checklists" ("employee_id")
  WHERE status = 'in_progress';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offboarding_tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "checklist_id" varchar NOT NULL REFERENCES "offboarding_checklists"("id") ON DELETE CASCADE,
  "template_task_id" varchar REFERENCES "offboarding_template_tasks"("id"),
  "title" varchar(200) NOT NULL,
  "description" text,
  "category" varchar(30) NOT NULL DEFAULT 'access',
  "owner_role" varchar(30) NOT NULL DEFAULT 'hr',
  "is_required" boolean NOT NULL DEFAULT true,
  "blocks_deactivation" boolean NOT NULL DEFAULT false,
  "due_date" date,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "notes" text,
  "skipped_reason" text,
  "completed_by" varchar REFERENCES "users"("id"),
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
