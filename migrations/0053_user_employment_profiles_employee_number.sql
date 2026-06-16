-- Task #427: add a payroll/employee number to the employment profile so the
-- imported spreadsheet `ID` can be stored on each employee (read-only on the
-- manager-facing Employee Profile). Nullable; existing rows stay empty.
-- Additive and safe to re-run.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "employee_number" varchar(20);
