-- Back-pay items: pay owed when an attendance correction lands on a day that was
-- ALREADY PAID in a finalized (exported/locked) payroll export. Instead of
-- blocking the correction, the timesheet is updated and the pay difference is
-- recorded here for ADMIN approval, then carried into the NEXT payroll batch as a
-- clearly-labeled line. Hour deltas come from a full recompute of the affected
-- week WITH the correction minus what the source export already paid; rates are
-- frozen from the source period. Deltas may be negative (a claw-back).
CREATE TABLE IF NOT EXISTS "payroll_backpay_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "work_date" date NOT NULL,
  "source_payroll_export_id" varchar REFERENCES "payroll_exports"("id"),
  "attendance_exception_id" varchar REFERENCES "attendance_exceptions"("id"),
  "punch_log_id" varchar REFERENCES "punch_logs"("id"),
  "reason" text NOT NULL,
  "regular_hours" real DEFAULT 0 NOT NULL,
  "overtime_hours" real DEFAULT 0 NOT NULL,
  "double_time_hours" real DEFAULT 0 NOT NULL,
  "hourly_rate" real,
  "overtime_multiplier" real,
  "double_time_multiplier" real,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "requested_by" varchar REFERENCES "users"("id"),
  "approved_by" varchar REFERENCES "users"("id"),
  "approved_at" timestamp,
  "review_notes" text,
  "paid_in_export_id" varchar REFERENCES "payroll_exports"("id"),
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

-- Fast lookup of what's owed to an employee (pending/approved) and of the items a
-- given export paid, which the next-batch builder and the approvals UI both need.
CREATE INDEX IF NOT EXISTS "payroll_backpay_items_employee_status_idx"
  ON "payroll_backpay_items" ("employee_id", "status");
CREATE INDEX IF NOT EXISTS "payroll_backpay_items_paid_in_export_idx"
  ON "payroll_backpay_items" ("paid_in_export_id");
