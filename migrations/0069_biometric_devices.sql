-- Biometric wall clocks (ADMS push devices) — Compumatic XLS Bio v2 / ZKTeco
-- fingerprint terminals that push punches to us over the "iclock" protocol.
-- See shared/schema.ts (biometricDevices, biometricDeviceUsers,
-- biometricDeviceEvents) and server/adms/*.
-- Additive and replay-safe (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS "biometric_devices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "serial_number" varchar(64) NOT NULL,
  "name" varchar(100) NOT NULL,
  "location_id" varchar,
  "company_id" varchar,
  "secret" varchar(128),
  "is_active" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp,
  "firmware" varchar(64),
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biometric_devices_serial_number_unique" ON "biometric_devices" ("serial_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_devices_location_idx" ON "biometric_devices" ("location_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_device_users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" varchar NOT NULL,
  "device_user_id" varchar(64) NOT NULL,
  "user_id" varchar NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biometric_device_users_device_user_uq" ON "biometric_device_users" ("device_id","device_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_device_users_user_idx" ON "biometric_device_users" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_device_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" varchar NOT NULL,
  "device_user_id" varchar(64) NOT NULL,
  "device_punch_time" varchar(32) NOT NULL,
  "device_status" varchar(16),
  "raw_line" text,
  "user_id" varchar,
  "punch_log_id" varchar,
  "direction" varchar(12),
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biometric_device_events_dedup_uq" ON "biometric_device_events" ("device_id","device_user_id","device_punch_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_device_events_device_idx" ON "biometric_device_events" ("device_id");
