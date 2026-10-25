-- Fingerprint "cloud brain" — Phase 2, Harvest step.
--  * fingerprint_templates: per-finger ZK/Compumatic templates pulled off a
--    clock (encrypted), tied to the Ahava employee once mapped. Distinct from
--    biometric_templates (that table is face-recognition descriptors, one per
--    user). Fingerprints are per-finger (finger_index 0–9) opaque vendor blobs.
--  * biometric_device_commands: a per-device command queue. getrequest hands the
--    clock its next pending command (e.g. "upload all your templates"); the
--    clock reports the result to /devicecmd. Also used later for Distribute
--    (pushing templates down to a new clock).
-- Additive and replay-safe.
CREATE TABLE IF NOT EXISTS "fingerprint_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar,
  "company_id" varchar,
  "source_device_id" varchar,
  "device_pin" varchar(64) NOT NULL,
  "finger_index" integer NOT NULL,
  "template_data" text NOT NULL,
  "template_format" varchar(16),
  "size" integer,
  "valid" boolean DEFAULT true NOT NULL,
  "encryption_key_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fingerprint_templates_source_unique" ON "fingerprint_templates" ("source_device_id","device_pin","finger_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fingerprint_templates_user_idx" ON "fingerprint_templates" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fingerprint_templates_pin_idx" ON "fingerprint_templates" ("device_pin");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_device_commands" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigserial NOT NULL,
  "device_id" varchar NOT NULL,
  "command" text NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp,
  "acked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_device_commands_device_idx" ON "biometric_device_commands" ("device_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biometric_device_commands_seq_unique" ON "biometric_device_commands" ("seq");
