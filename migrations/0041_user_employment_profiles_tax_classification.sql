-- Task #255: add W-2 / 1099 tax classification per employee.
-- Existing rows default to "W-2"; admins can change individuals to "1099".
-- Safe to re-run.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "tax_classification" varchar(10) DEFAULT 'W-2' NOT NULL;
