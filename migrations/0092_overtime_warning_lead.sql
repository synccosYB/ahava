-- Configurable lead margin for the "approaching weekly overtime" warning.
-- The warning fires at the weekly OT threshold minus this many minutes
-- (default 15 → 39:45 for a 40h threshold), so admins can tune the heads-up
-- without an env var / redeploy.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "overtime_warning_lead_minutes" integer DEFAULT 15 NOT NULL;
