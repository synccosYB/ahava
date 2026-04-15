ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "balance_at_submission" integer;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "expiration_date" date;
