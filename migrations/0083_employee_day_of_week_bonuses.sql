-- Per-employee day-of-week bonuses (additive on top of policy bonuses).
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "day_of_week_bonuses" jsonb DEFAULT '[]'::jsonb NOT NULL;
