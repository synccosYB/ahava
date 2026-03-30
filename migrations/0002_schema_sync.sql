-- Schema sync migration: align database with Drizzle schema definitions
-- All operations are idempotent (IF NOT EXISTS / DO EXCEPTION guards)
-- Handles both fresh databases and pre-existing out-of-sync databases

-- Legacy remediation: ensure users table has all required columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" varchar;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" varchar;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "location_id" varchar;
--> statement-breakpoint

-- companies: add columns defined in schema
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name varchar(200);
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS slug varchar(100);
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email varchar(200);
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone varchar(50) DEFAULT 'America/New_York';
--> statement-breakpoint

-- locations: add columns defined in schema
ALTER TABLE locations ADD COLUMN IF NOT EXISTS code varchar(20);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address varchar(500);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address_1 varchar(200);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS city varchar(100);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS state varchar(50);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS zip varchar(20);
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN IF NOT EXISTS timezone varchar(50);
--> statement-breakpoint

-- Legacy remediation: ensure RBAC tables exist
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL DEFAULT '',
	"description" varchar(500),
	"module" varchar(50),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" varchar NOT NULL,
	"permission_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "role_permission_unique" UNIQUE("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"role_id" varchar NOT NULL,
	"company_id" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_role_unique" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"permission_id" varchar NOT NULL,
	"allowed" boolean NOT NULL,
	"reason" varchar(500),
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_permission_override_unique" UNIQUE("user_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_access_scopes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"scope_type" varchar(30) NOT NULL,
	"company_id" varchar,
	"location_id" varchar,
	"department_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"module" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "policy_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint

-- Ensure user_employment_profiles exists
CREATE TABLE IF NOT EXISTS "user_employment_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"employment_type" varchar(30) DEFAULT 'full_time' NOT NULL,
	"pay_type" varchar(20) DEFAULT 'hourly' NOT NULL,
	"hourly_rate" real,
	"weekly_salary" real,
	"daily_salary" real,
	"overtime_eligible" boolean DEFAULT false NOT NULL,
	"holiday_pay_enabled" boolean DEFAULT false NOT NULL,
	"voluntary_pay_enabled" boolean DEFAULT false NOT NULL,
	"hire_date" date,
	"termination_date" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_employment_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_employment_profiles" ADD CONSTRAINT "user_employment_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- user_employment_profiles: add missing pay/benefit columns if table pre-existed
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS hourly_rate real;
--> statement-breakpoint
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS weekly_salary real;
--> statement-breakpoint
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS daily_salary real;
--> statement-breakpoint
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS overtime_eligible boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS holiday_pay_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS voluntary_pay_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- New tables not in any previous migration
CREATE TABLE IF NOT EXISTS "punch_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"work_date" date NOT NULL,
	"clock_in" timestamp,
	"clock_out" timestamp,
	"break_minutes" integer DEFAULT 0,
	"hours_worked" real,
	"status" varchar(20) DEFAULT 'present' NOT NULL,
	"notes" text,
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_exceptions" (
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
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" varchar NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"context" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"policy_type_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" varchar NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" varchar NOT NULL,
	"company_id" varchar,
	"location_id" varchar,
	"department_id" varchar,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"employee_id" varchar,
	"message" text NOT NULL,
	"details" jsonb,
	"acknowledged_by" varchar,
	"acknowledged_at" timestamp,
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_exports" (
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
CREATE TABLE IF NOT EXISTS "payroll_batch_records" (
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
CREATE TABLE IF NOT EXISTS "payroll_adjustments" (
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

-- Remediate audit_logs: 0001_brainy_vermin created it with different columns
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_user_id" varchar;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "target_type" varchar(50);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "target_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "old_value" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_value" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "context" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" varchar(45);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint

-- Remediate attendance_exceptions: add columns that may be missing
ALTER TABLE "attendance_exceptions" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD COLUMN IF NOT EXISTS "review_notes" text;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD COLUMN IF NOT EXISTS "punch_log_id" varchar;
--> statement-breakpoint

-- Remediate policies: add columns that may be missing
ALTER TABLE policies ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE policies ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint

-- policy_rules: add rules jsonb and updated_at
ALTER TABLE policy_rules ADD COLUMN IF NOT EXISTS rules jsonb;
--> statement-breakpoint
ALTER TABLE policy_rules ADD COLUMN IF NOT EXISTS updated_at timestamp;
--> statement-breakpoint

-- policy_assignments: add user_id
ALTER TABLE policy_assignments ADD COLUMN IF NOT EXISTS user_id varchar;
--> statement-breakpoint

-- punch_logs: add missing columns if table pre-existed
ALTER TABLE punch_logs ADD COLUMN IF NOT EXISTS notes text;
--> statement-breakpoint
ALTER TABLE punch_logs ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'web';
--> statement-breakpoint

-- Add missing columns to existing tables
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "name" varchar(200) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD COLUMN IF NOT EXISTS "vacation_balance_override" real;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD COLUMN IF NOT EXISTS "sick_balance_override" real;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD COLUMN IF NOT EXISTS "personal_balance_override" real;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD COLUMN IF NOT EXISTS "hire_date" date;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "accrual_type" varchar(30) DEFAULT 'annual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "yearly_cap_hours" real;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "carryover_cap_hours" real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "sick_accrual_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "sick_accrual_rate_per_hours" real DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "sick_accrual_per_hours_worked" real DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "sick_yearly_cap_hours" real DEFAULT 40 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "personal_days_per_year" real DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "holiday_pay_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "holiday_pto_deduction" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "holiday_ot_exclusion" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- payroll_exports: add missing columns if table pre-existed
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS company_id varchar;
--> statement-breakpoint
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS exported_by varchar;
--> statement-breakpoint
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS locked_by varchar;
--> statement-breakpoint
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS reopened_by varchar;
--> statement-breakpoint
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS notes text;
--> statement-breakpoint

-- Foreign key constraints (idempotent)
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_access_scopes" ADD CONSTRAINT "user_access_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_access_scopes" ADD CONSTRAINT "user_access_scopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_access_scopes" ADD CONSTRAINT "user_access_scopes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_access_scopes" ADD CONSTRAINT "user_access_scopes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "punch_logs" ADD CONSTRAINT "punch_logs_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policies" ADD CONSTRAINT "policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policies" ADD CONSTRAINT "policies_policy_type_id_policy_types_id_fk" FOREIGN KEY ("policy_type_id") REFERENCES "public"."policy_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employee_pto_settings" ADD CONSTRAINT "employee_pto_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employee_pto_settings" ADD CONSTRAINT "employee_pto_settings_pto_policy_id_pto_policies_id_fk" FOREIGN KEY ("pto_policy_id") REFERENCES "public"."pto_policies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pto_policies" ADD CONSTRAINT "pto_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
