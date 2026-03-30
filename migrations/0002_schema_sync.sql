-- Schema sync migration: align database with Drizzle schema definitions
-- Adds missing columns defined in shared/schema.ts and shared/models/auth.ts
-- All operations are additive (ADD COLUMN IF NOT EXISTS) and idempotent

-- companies: add columns defined in schema
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS slug varchar(100) UNIQUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address varchar(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone varchar(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone varchar(50) DEFAULT 'America/New_York';
--> statement-breakpoint

-- locations: add columns defined in schema
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address varchar(500);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address_1 varchar(200);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS timezone varchar(50);
--> statement-breakpoint

-- policies: add status and version columns
ALTER TABLE policies ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'draft';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint

-- policy_rules: add rules jsonb and updated_at
ALTER TABLE policy_rules ADD COLUMN IF NOT EXISTS rules jsonb;
ALTER TABLE policy_rules ADD COLUMN IF NOT EXISTS updated_at timestamp;
--> statement-breakpoint

-- policy_assignments: add user_id
ALTER TABLE policy_assignments ADD COLUMN IF NOT EXISTS user_id varchar;
--> statement-breakpoint

-- user_employment_profiles: add missing pay/benefit columns
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS hourly_rate real;
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS weekly_salary real;
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS daily_salary real;
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS overtime_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS holiday_pay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE user_employment_profiles ADD COLUMN IF NOT EXISTS voluntary_pay_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- employee_pto_settings: add balance override columns
ALTER TABLE employee_pto_settings ADD COLUMN IF NOT EXISTS vacation_balance_override real;
ALTER TABLE employee_pto_settings ADD COLUMN IF NOT EXISTS sick_balance_override real;
ALTER TABLE employee_pto_settings ADD COLUMN IF NOT EXISTS personal_balance_override real;
ALTER TABLE employee_pto_settings ADD COLUMN IF NOT EXISTS hire_date date;
ALTER TABLE employee_pto_settings ADD COLUMN IF NOT EXISTS notes text;
--> statement-breakpoint

-- pto_policies: add comprehensive PTO config columns
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS accrual_type varchar(30) NOT NULL DEFAULT 'annual';
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS yearly_cap_hours real;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS carryover_cap_hours real DEFAULT 0;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS sick_accrual_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS sick_accrual_rate_per_hours real NOT NULL DEFAULT 1;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS sick_accrual_per_hours_worked real NOT NULL DEFAULT 30;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS sick_yearly_cap_hours real NOT NULL DEFAULT 40;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS personal_days_per_year real NOT NULL DEFAULT 5;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS holiday_pay_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS holiday_pto_deduction boolean NOT NULL DEFAULT false;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS holiday_ot_exclusion boolean NOT NULL DEFAULT true;
ALTER TABLE pto_policies ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- payroll_exports: add missing columns
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS company_id varchar;
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS exported_by varchar;
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS locked_by varchar;
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS reopened_by varchar;
ALTER TABLE payroll_exports ADD COLUMN IF NOT EXISTS notes text;
--> statement-breakpoint

-- punch_logs: add missing columns
ALTER TABLE punch_logs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE punch_logs ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'web';
--> statement-breakpoint

-- attendance_exceptions: add missing columns
ALTER TABLE attendance_exceptions ADD COLUMN IF NOT EXISTS reviewed_at timestamp;
ALTER TABLE attendance_exceptions ADD COLUMN IF NOT EXISTS review_notes text;
