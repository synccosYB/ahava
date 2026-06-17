-- Task #464: canonical per-employee-per-day attendance ledger.
-- One materialized row per (employee, work_date) holding the unified pay
-- engine's daily split. Additive and replay-safe (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS "attendance_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "work_date" date NOT NULL,
  "regular_hours" real NOT NULL DEFAULT 0,
  "overtime_hours" real NOT NULL DEFAULT 0,
  "double_time_hours" real NOT NULL DEFAULT 0,
  "total_hours" real NOT NULL DEFAULT 0,
  "pto_hours" real NOT NULL DEFAULT 0,
  "is_holiday" boolean NOT NULL DEFAULT false,
  "has_open_punch" boolean NOT NULL DEFAULT false,
  "status" varchar(20) NOT NULL DEFAULT 'complete',
  "source_punch_count" integer NOT NULL DEFAULT 0,
  "attendance_policy_version" integer,
  "payroll_policy_version" integer,
  "computed_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_ledger_employee_work_date_idx" ON "attendance_ledger" ("employee_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_ledger_work_date_idx" ON "attendance_ledger" ("work_date");
