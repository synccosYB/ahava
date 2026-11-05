-- Per-employee "works overnight shifts" flag. Defaults false: for most (on-site)
-- staff a shift that crosses midnight is a forgotten punch-out, so the system
-- caps the evening punch as a missing punch and starts the next day's punch as a
-- fresh shift. Turn it on only for genuine overnight workers so their real
-- cross-midnight shifts aren't flagged or split. Additive and replay-safe.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "overnight_shifts_allowed" boolean DEFAULT false NOT NULL;
