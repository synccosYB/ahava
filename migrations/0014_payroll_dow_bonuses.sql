-- Add day-of-week bonus tracking columns to payroll_batch_records (FR-0047)
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "bonus_amount" real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "bonus_hours" real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "bonus_description" text;
