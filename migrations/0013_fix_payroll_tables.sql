-- Fix payroll_exports and payroll_batch_records tables
-- Both tables have integer columns but the Drizzle schema expects varchar columns.
-- All three payroll tables have zero rows, so drop+recreate is safe.
-- payroll_adjustments depends on payroll_exports via FK, so we must also recreate it.

DROP TABLE IF EXISTS "payroll_adjustments" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payroll_batch_records" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payroll_exports" CASCADE;
--> statement-breakpoint
CREATE TABLE "payroll_exports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"exported_at" timestamp,
	"exported_by" varchar,
	"locked_at" timestamp,
	"locked_by" varchar,
	"reopened_at" timestamp,
	"reopened_by" varchar,
	"notes" text,
	"record_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "payroll_batch_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_export_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"punch_log_id" varchar,
	"time_off_request_id" varchar,
	"record_type" varchar(20) NOT NULL,
	"work_date" date NOT NULL,
	"regular_hours" real DEFAULT 0,
	"overtime_hours" real DEFAULT 0,
	"pto_hours" real DEFAULT 0,
	"has_issues" boolean DEFAULT false NOT NULL,
	"issue_description" text,
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
  ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_batch_records" ADD CONSTRAINT "payroll_batch_records_payroll_export_id_payroll_exports_id_fk" FOREIGN KEY ("payroll_export_id") REFERENCES "public"."payroll_exports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_batch_records" ADD CONSTRAINT "payroll_batch_records_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_batch_records" ADD CONSTRAINT "payroll_batch_records_punch_log_id_punch_logs_id_fk" FOREIGN KEY ("punch_log_id") REFERENCES "public"."punch_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_batch_records" ADD CONSTRAINT "payroll_batch_records_time_off_request_id_time_off_requests_id_fk" FOREIGN KEY ("time_off_request_id") REFERENCES "public"."time_off_requests"("id") ON DELETE no action ON UPDATE no action;
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
