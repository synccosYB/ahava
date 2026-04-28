-- Additive: add the users.deactivated_at column that the Drizzle model and
-- deactivate/reactivate flows rely on. Without it, every auth path 500s
-- because AuthStorage.getUser does SELECT * FROM users. Safe to re-run.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp;
