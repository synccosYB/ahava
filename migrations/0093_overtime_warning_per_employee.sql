-- Per-employee override for the "approaching weekly overtime" warning.
-- NULL = follow the policy (default, so nothing changes for existing staff),
-- TRUE = always warn this employee, FALSE = never warn this employee.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "overtime_warning_enabled" boolean;
