ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "days_approved" integer;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "approved_end_date" date;