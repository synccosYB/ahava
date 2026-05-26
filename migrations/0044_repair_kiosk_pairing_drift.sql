-- Repair migration for task #282.
-- Re-applies all artifacts from 0035_kiosk_pairing_heartbeat idempotently.
-- The 0035 file runs as one multi-statement query, so a mid-statement
-- failure could leave it half-applied while still being recorded in
-- _migration_log, surfacing later as 'column kiosk_device_id does not
-- exist' on the Time report. Every statement here is guarded with
-- IF NOT EXISTS / DO blocks so this is safe on environments where 0035
-- already applied cleanly.

ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "pairing_code" varchar(16);
--> statement-breakpoint

ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "pairing_code_expires_at" timestamp;
--> statement-breakpoint

ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "paired_at" timestamp;
--> statement-breakpoint

ALTER TABLE "kiosk_devices"
  ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'unpaired';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_kiosk_devices_pairing_code"
  ON "kiosk_devices" ("pairing_code");
--> statement-breakpoint

ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "kiosk_device_id" varchar;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'punch_logs'
      AND constraint_name = 'punch_logs_kiosk_device_id_fkey'
  ) THEN
    ALTER TABLE "punch_logs"
      ADD CONSTRAINT "punch_logs_kiosk_device_id_fkey"
      FOREIGN KEY ("kiosk_device_id") REFERENCES "kiosk_devices"("id");
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_punch_logs_kiosk_device"
  ON "punch_logs" ("kiosk_device_id");
--> statement-breakpoint

INSERT INTO "_migration_log" (tag)
VALUES ('0035_kiosk_pairing_heartbeat')
ON CONFLICT DO NOTHING;
