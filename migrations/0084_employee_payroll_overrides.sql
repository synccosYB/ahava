-- Per-employee payroll RULE overrides (Composable Payroll Rules). Each set key
-- in this JSON overlays that one rule from the employee's effective payroll
-- policy; unset keys fall through to the policy, then to the defaults. Empty {}
-- is a no-op, so existing employees are unaffected until an admin sets a rule.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "payroll_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;
