CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(100) NOT NULL,
	"module" varchar(50) NOT NULL,
	"target_id" varchar,
	"target_type" varchar(50),
	"performed_by" varchar,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_pto_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"pto_policy_id" varchar,
	"vacation_balance_override" real,
	"sick_balance_override" real,
	"personal_balance_override" real,
	"hire_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "employee_pto_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "pto_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"company_id" varchar,
	"accrual_type" varchar(30) DEFAULT 'annual' NOT NULL,
	"accrual_rate" real DEFAULT 15 NOT NULL,
	"yearly_cap_hours" real,
	"carryover_cap_hours" real DEFAULT 0,
	"waiting_period_days" integer DEFAULT 0 NOT NULL,
	"sick_accrual_enabled" boolean DEFAULT true NOT NULL,
	"sick_accrual_rate_per_hours" real DEFAULT 1 NOT NULL,
	"sick_accrual_per_hours_worked" real DEFAULT 30 NOT NULL,
	"sick_yearly_cap_hours" real DEFAULT 40 NOT NULL,
	"holiday_pay_enabled" boolean DEFAULT true NOT NULL,
	"holiday_pto_deduction" boolean DEFAULT false NOT NULL,
	"holiday_ot_exclusion" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD CONSTRAINT "employee_pto_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pto_settings" ADD CONSTRAINT "employee_pto_settings_pto_policy_id_pto_policies_id_fk" FOREIGN KEY ("pto_policy_id") REFERENCES "public"."pto_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pto_policies" ADD CONSTRAINT "pto_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;