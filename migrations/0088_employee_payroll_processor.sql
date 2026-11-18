-- The third-party payroll PROCESSOR an employee's pay is run through (e.g.
-- "EZ Payroll", "PC Payroll", "Inhouse", "Hirschfeld Oncology"). Identifies who
-- cuts the check, distinct from the paying company. Nullable; unset for existing
-- employees until set via the employee sheet or the profile form.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "payroll_processor" varchar(40);
