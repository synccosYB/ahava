CREATE TABLE IF NOT EXISTS "biometric_settings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" varchar(32) NOT NULL UNIQUE DEFAULT 'global',
  "feature_enabled" boolean NOT NULL DEFAULT false,
  "threshold_auto_approve" real NOT NULL DEFAULT 0.90,
  "threshold_review" real NOT NULL DEFAULT 0.75,
  "threshold_reject" real NOT NULL DEFAULT 0.60,
  "required_sample_count" integer NOT NULL DEFAULT 3,
  "default_retention_days" integer NOT NULL DEFAULT 180,
  "supervisor_override_threshold" integer NOT NULL DEFAULT 3,
  "allow_non_kiosk_enrollment" boolean NOT NULL DEFAULT false,
  "encryption_key_version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp DEFAULT now(),
  "updated_by" varchar
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_legal_profiles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL UNIQUE,
  "description" text,
  "consent_text" text NOT NULL,
  "consent_version" integer NOT NULL DEFAULT 1,
  "retention_days" integer NOT NULL DEFAULT 180,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_legal_profile_scopes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" varchar NOT NULL REFERENCES "biometric_legal_profiles"("id") ON DELETE CASCADE,
  "company_id" varchar REFERENCES "companies"("id"),
  "location_id" varchar REFERENCES "locations"("id"),
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_consents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "legal_profile_id" varchar NOT NULL REFERENCES "biometric_legal_profiles"("id"),
  "consent_version" integer NOT NULL,
  "consent_text_snapshot" text NOT NULL,
  "accepted_at" timestamp NOT NULL DEFAULT now(),
  "accepted_ip" varchar(64),
  "accepted_user_agent" text,
  "revoked_at" timestamp,
  "revoked_by" varchar REFERENCES "users"("id"),
  "revoked_reason" text,
  "legal_hold" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_consents_user_idx" ON "biometric_consents" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(20) NOT NULL,
  "company_id" varchar REFERENCES "companies"("id"),
  "encrypted_template" text NOT NULL,
  "encryption_key_version" integer NOT NULL DEFAULT 1,
  "sample_count" integer NOT NULL DEFAULT 1,
  "enrolled_kiosk_id" varchar REFERENCES "kiosk_devices"("id"),
  "enrolled_by_user_id" varchar REFERENCES "users"("id"),
  "last_matched_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "biometric_templates_user_type_unique" UNIQUE ("user_id", "type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_templates_company_type_idx" ON "biometric_templates" ("company_id", "type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_attempts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(20) NOT NULL DEFAULT 'face',
  "candidate_user_id" varchar REFERENCES "users"("id"),
  "kiosk_device_id" varchar REFERENCES "kiosk_devices"("id"),
  "company_id" varchar REFERENCES "companies"("id"),
  "outcome" varchar(32) NOT NULL,
  "confidence" real,
  "liveness_passed" boolean,
  "fallback_used" varchar(32),
  "consecutive_failure_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_attempts_created_at_idx" ON "biometric_attempts" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_attempts_kiosk_idx" ON "biometric_attempts" ("kiosk_device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_attempts_candidate_idx" ON "biometric_attempts" ("candidate_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_attempts_outcome_idx" ON "biometric_attempts" ("outcome");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_supervisor_overrides" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "supervisor_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "employee_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "kiosk_device_id" varchar REFERENCES "kiosk_devices"("id"),
  "punch_type" varchar(16) NOT NULL,
  "reason" text,
  "prior_failed_attempts" integer NOT NULL DEFAULT 0,
  "punch_log_id" varchar REFERENCES "punch_logs"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_overrides_created_at_idx" ON "biometric_supervisor_overrides" ("created_at");
