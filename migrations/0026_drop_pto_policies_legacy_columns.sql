-- Drop legacy columns from pto_policies that have drifted away from the
-- current Drizzle schema. The legacy `type` column is NOT NULL with no
-- default, which makes every insert fail with a 500 error from the PTO &
-- Leave page. The other three columns are unused and were superseded by
-- accrual_type / yearly_cap_hours / carryover_cap_hours in shared/schema.ts.

ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "type";
--> statement-breakpoint
ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "accrual_period";
--> statement-breakpoint
ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "max_balance";
--> statement-breakpoint
ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "carry_over_limit";
