CREATE TABLE IF NOT EXISTS "role_assignment_rules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(200) NOT NULL,
  "description" text,
  "conditions" jsonb NOT NULL,
  "target_role" varchar(20) NOT NULL,
  "priority" integer NOT NULL DEFAULT 100,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_assignment_rules_active_priority_idx" ON "role_assignment_rules" ("is_active", "priority");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(200) NOT NULL,
  "description" text,
  "company_id" varchar REFERENCES "companies"("id"),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "role_assignment_rules" DROP COLUMN IF EXISTS "is_archived";
--> statement-breakpoint
ALTER TABLE "role_assignment_rules" DROP COLUMN IF EXISTS "archived_at";
--> statement-breakpoint
ALTER TABLE "schedule_templates" DROP COLUMN IF EXISTS "is_archived";
--> statement-breakpoint
ALTER TABLE "schedule_templates" DROP COLUMN IF EXISTS "archived_at";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_template_days" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" varchar NOT NULL REFERENCES "schedule_templates"("id") ON DELETE CASCADE,
  "day_of_week" integer NOT NULL,
  "start_time" varchar(5) NOT NULL DEFAULT '09:00',
  "end_time" varchar(5) NOT NULL DEFAULT '17:00',
  "is_work_day" boolean NOT NULL DEFAULT true,
  CONSTRAINT "schedule_template_day_unique" UNIQUE ("template_id", "day_of_week")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_manually_overridden_at" timestamp;
--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD COLUMN IF NOT EXISTS "schedule_template_id" varchar;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employee_schedules_schedule_template_id_schedule_templates_id_fk'
      AND table_name = 'employee_schedules'
  ) THEN
    ALTER TABLE "employee_schedules"
      ADD CONSTRAINT "employee_schedules_schedule_template_id_schedule_templates_id_fk"
      FOREIGN KEY ("schedule_template_id") REFERENCES "schedule_templates"("id") ON DELETE SET NULL;
  END IF;
END $$;
