-- Per-day "Send to Payroll" confirmations. Each row is one complete day an admin
-- confirmed for an employee; missing-punch days are deliberately not recorded
-- (they stay open for a later run). A day is sent at most once per employee.
CREATE TABLE IF NOT EXISTS "payroll_submissions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "work_date" date NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "sent_by" varchar REFERENCES "users"("id"),
  "payroll_export_id" varchar REFERENCES "payroll_exports"("id"),
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_payroll_submission_employee_day"
  ON "payroll_submissions" ("employee_id", "work_date");
