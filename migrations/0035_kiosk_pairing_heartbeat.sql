-- Kiosk pairing flow, heartbeat-driven status, and punch attribution.
-- Additive and replay-safe.

ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "pairing_code" varchar(16);
ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "pairing_code_expires_at" timestamp;
ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "paired_at" timestamp;
ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'unpaired';

CREATE INDEX IF NOT EXISTS "idx_kiosk_devices_pairing_code"
  ON "kiosk_devices" ("pairing_code");

ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "kiosk_device_id" varchar
  REFERENCES "kiosk_devices"("id");

CREATE INDEX IF NOT EXISTS "idx_punch_logs_kiosk_device"
  ON "punch_logs" ("kiosk_device_id");
