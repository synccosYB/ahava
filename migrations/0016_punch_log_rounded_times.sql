ALTER TABLE "punch_logs" ADD COLUMN IF NOT EXISTS "rounded_clock_in" timestamp;--> statement-breakpoint
ALTER TABLE "punch_logs" ADD COLUMN IF NOT EXISTS "rounded_clock_out" timestamp;--> statement-breakpoint
UPDATE "punch_logs" SET "rounded_clock_in" = "clock_in" WHERE "rounded_clock_in" IS NULL AND "clock_in" IS NOT NULL;--> statement-breakpoint
UPDATE "punch_logs" SET "rounded_clock_out" = "clock_out" WHERE "rounded_clock_out" IS NULL AND "clock_out" IS NOT NULL;
