-- Drop and recreate attendance_exceptions and payroll_adjustments tables
-- Both tables have zero rows, so this is safe.
-- The DB currently has integer columns but the Drizzle schema expects varchar columns.

DROP TABLE IF EXISTS "attendance_exceptions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payroll_adjustments" CASCADE;
--> statement-breakpoint
CREATE TABLE "attendance_exceptions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "employee_id" varchar NOT NULL,
        "exception_date" date NOT NULL,
        "exception_time" timestamp,
        "type" varchar(30) NOT NULL,
        "reason" text NOT NULL,
        "status" varchar(20) DEFAULT 'pending' NOT NULL,
        "reviewed_by" varchar,
        "reviewed_at" timestamp,
        "review_notes" text,
        "punch_log_id" varchar,
        "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "payroll_export_id" varchar NOT NULL,
        "employee_id" varchar NOT NULL,
        "punch_log_id" varchar,
        "adjustment_date" date NOT NULL,
        "reason" text NOT NULL,
        "status" varchar(20) DEFAULT 'pending' NOT NULL,
        "reviewed_by" varchar,
        "reviewed_at" timestamp,
        "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_punch_log_id_punch_logs_id_fk" FOREIGN KEY ("punch_log_id") REFERENCES "public"."punch_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_export_id_payroll_exports_id_fk" FOREIGN KEY ("payroll_export_id") REFERENCES "public"."payroll_exports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_punch_log_id_punch_logs_id_fk" FOREIGN KEY ("punch_log_id") REFERENCES "public"."punch_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
INSERT INTO "_migration_log" (tag) VALUES ('0001_brainy_vermin') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "_migration_log" (tag) VALUES ('0002_schema_sync') ON CONFLICT DO NOTHING;
