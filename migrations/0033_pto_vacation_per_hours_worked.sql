ALTER TABLE "pto_policies"
  ADD COLUMN IF NOT EXISTS "vacation_accrual_per_hours_worked" real DEFAULT 30 NOT NULL,
  ADD COLUMN IF NOT EXISTS "vacation_accrual_hours_per_threshold" real DEFAULT 1 NOT NULL;
