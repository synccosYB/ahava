-- Note #5 (refinement): 1099 payee — "pay to the order of". A 1099 worker's
-- check is written to a company/LLC name (not the person), with optional mailing
-- address and Tax ID. The paying entity (Ahava / BCM) stays in payroll_company_id;
-- these columns are the external payee the check is made out to. Only the name is
-- required at entry; the rest are optional. Additive and replay-safe.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_address" varchar(500);
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_city" varchar(100);
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_state" varchar(50);
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_zip" varchar(20);
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_tax_id" varchar(40);
