-- Task #475: payroll-only company per employee.
-- (1) A nullable payroll company on the employment profile, INDEPENDENT of the
--     assignment-derived company. Existing rows stay empty (graceful blank).
-- (2) A frozen payroll-company snapshot (id + resolved name) on each payroll
--     batch record so editing an employee's payroll company later never
--     relabels already-exported historical rows. Null on legacy rows.
-- All additive and safe to re-run.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "payroll_company_id" varchar REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "payroll_company_id" varchar REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "payroll_company_name" varchar(255);
