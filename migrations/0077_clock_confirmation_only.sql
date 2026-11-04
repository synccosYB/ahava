-- Confirmation-only clocking: a fixed-salary (daily/weekly) employee whose clock
-- is only an attendance confirmation, not an hours record. One clock per day
-- marks the day present, hours are not counted, and a single daily punch is never
-- flagged a missing punch. Additive and replay-safe; defaults false so existing
-- employees keep the normal "clock in AND out" behaviour.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "clock_confirmation_only" boolean DEFAULT false NOT NULL;
