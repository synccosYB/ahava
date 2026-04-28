-- Additive: extend biometric_settings with the per-modality and lockout knobs
-- that the admin UI and matcher rely on. Safe to re-run; all ADD COLUMN are
-- IF NOT EXISTS.

ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "face_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "liveness_required" boolean NOT NULL DEFAULT true;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "min_samples_per_enrollment" integer NOT NULL DEFAULT 3;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "max_samples_per_enrollment" integer NOT NULL DEFAULT 5;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "max_attempts_before_lockout" integer NOT NULL DEFAULT 5;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "lockout_duration_minutes" integer NOT NULL DEFAULT 10;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "supervisor_override_requires_pin" boolean NOT NULL DEFAULT true;
ALTER TABLE "biometric_settings"
  ADD COLUMN IF NOT EXISTS "match_timeout_ms" integer NOT NULL DEFAULT 3000;
