-- Task #284: Flexible Onboarding & Offboarding template builder.
-- Additive, replay-safe expansion of migration 0040's lifecycle tables.
-- All new tables/columns/indexes use IF NOT EXISTS so this can replay safely
-- even if 0040 has not yet been applied (the dependent tables exist from 0040).

-- Widen free-text category to fit admin-defined values.
ALTER TABLE "onboarding_template_tasks" ALTER COLUMN "category" TYPE varchar(100);
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ALTER COLUMN "category" TYPE varchar(100);
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ALTER COLUMN "category" TYPE varchar(100);
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ALTER COLUMN "category" TYPE varchar(100);
--> statement-breakpoint

-- ===== Sections =====
CREATE TABLE IF NOT EXISTS "onboarding_template_sections" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "onboarding_templates"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_sections_template" ON "onboarding_template_sections" ("template_id", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offboarding_template_sections" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "offboarding_templates"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_sections_template" ON "offboarding_template_sections" ("template_id", "sort_order");
--> statement-breakpoint

-- ===== Scopes =====
CREATE TABLE IF NOT EXISTS "onboarding_template_scopes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "onboarding_templates"("id") ON DELETE CASCADE,
  "scope_kind" varchar(30) NOT NULL,
  "scope_ref" varchar(100) NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_scopes_template" ON "onboarding_template_scopes" ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onb_scopes_kind_ref" ON "onboarding_template_scopes" ("scope_kind", "scope_ref");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offboarding_template_scopes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "offboarding_templates"("id") ON DELETE CASCADE,
  "scope_kind" varchar(30) NOT NULL,
  "scope_ref" varchar(100) NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_scopes_template" ON "offboarding_template_scopes" ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_off_scopes_kind_ref" ON "offboarding_template_scopes" ("scope_kind", "scope_ref");
--> statement-breakpoint

-- ===== Flexible columns on template tasks =====
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "section_id" varchar REFERENCES "onboarding_template_sections"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "task_type" varchar(30) NOT NULL DEFAULT 'checkbox';
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_kind" varchar(20) NOT NULL DEFAULT 'role';
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_user_id" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_department_id" varchar REFERENCES "departments"("id");
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "due_rule" jsonb;
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "instructions" text;
--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD COLUMN IF NOT EXISTS "link_url" varchar(500);
--> statement-breakpoint

ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "section_id" varchar REFERENCES "offboarding_template_sections"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "task_type" varchar(30) NOT NULL DEFAULT 'checkbox';
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_kind" varchar(20) NOT NULL DEFAULT 'role';
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_user_id" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "owner_department_id" varchar REFERENCES "departments"("id");
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "due_rule" jsonb;
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "instructions" text;
--> statement-breakpoint
ALTER TABLE "offboarding_template_tasks" ADD COLUMN IF NOT EXISTS "link_url" varchar(500);
--> statement-breakpoint

-- ===== Flexible columns on materialized tasks =====
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "section_title" varchar(200);
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "section_sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "task_type" varchar(30) NOT NULL DEFAULT 'checkbox';
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_kind" varchar(20) NOT NULL DEFAULT 'role';
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_user_id" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_department_id" varchar REFERENCES "departments"("id");
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "response_value" jsonb;
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "instructions" text;
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "link_url" varchar(500);
--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD COLUMN IF NOT EXISTS "attachment_url" varchar(500);
--> statement-breakpoint

ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "section_title" varchar(200);
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "section_sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "task_type" varchar(30) NOT NULL DEFAULT 'checkbox';
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_kind" varchar(20) NOT NULL DEFAULT 'role';
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_user_id" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "owner_department_id" varchar REFERENCES "departments"("id");
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "response_value" jsonb;
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "instructions" text;
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "link_url" varchar(500);
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD COLUMN IF NOT EXISTS "attachment_url" varchar(500);
