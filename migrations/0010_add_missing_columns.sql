ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "request_category" varchar(20) DEFAULT 'time_off' NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "exceeds_balance" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "balance_at_submission" integer;
--> statement-breakpoint
ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "expiration_date" date;
--> statement-breakpoint
ALTER TABLE "time_off_balances" ADD COLUMN IF NOT EXISTS "expiration_date" date;
