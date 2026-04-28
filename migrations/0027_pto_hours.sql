-- Convert PTO/leave system from days to hours as the single unit.

-- pto_policies: rename accrual_rate -> accrual_hours_per_year (default 120)
ALTER TABLE "pto_policies" RENAME COLUMN "accrual_rate" TO "accrual_hours_per_year";
--> statement-breakpoint
UPDATE "pto_policies" SET "accrual_hours_per_year" = "accrual_hours_per_year" * 8;
--> statement-breakpoint
ALTER TABLE "pto_policies" ALTER COLUMN "accrual_hours_per_year" SET DEFAULT 120;
--> statement-breakpoint

-- pto_policies: rename personal_days_per_year -> personal_hours_per_year (default 40)
ALTER TABLE "pto_policies" RENAME COLUMN "personal_days_per_year" TO "personal_hours_per_year";
--> statement-breakpoint
UPDATE "pto_policies" SET "personal_hours_per_year" = "personal_hours_per_year" * 8;
--> statement-breakpoint
ALTER TABLE "pto_policies" ALTER COLUMN "personal_hours_per_year" SET DEFAULT 40;
--> statement-breakpoint

-- time_off_requests: rename days_requested -> hours_requested (default 8)
ALTER TABLE "time_off_requests" RENAME COLUMN "days_requested" TO "hours_requested";
--> statement-breakpoint
ALTER TABLE "time_off_requests" ALTER COLUMN "hours_requested" TYPE real USING ("hours_requested"::real);
--> statement-breakpoint
UPDATE "time_off_requests" SET "hours_requested" = "hours_requested" * 8;
--> statement-breakpoint
ALTER TABLE "time_off_requests" ALTER COLUMN "hours_requested" SET DEFAULT 8;
--> statement-breakpoint

-- time_off_requests: rename days_approved -> hours_approved
ALTER TABLE "time_off_requests" RENAME COLUMN "days_approved" TO "hours_approved";
--> statement-breakpoint
ALTER TABLE "time_off_requests" ALTER COLUMN "hours_approved" TYPE real USING ("hours_approved"::real);
--> statement-breakpoint
UPDATE "time_off_requests" SET "hours_approved" = "hours_approved" * 8 WHERE "hours_approved" IS NOT NULL;
--> statement-breakpoint

-- policy_rules.rules JSONB key migration: rename PTO rule keys and multiply by 8
UPDATE "policy_rules" pr
SET "rules" = (
  ("rules" - 'accrualRate' - 'personalDaysPerYear' - 'maxConsecutiveDays')
  || CASE WHEN "rules" ? 'accrualRate'
       THEN jsonb_build_object('accrualHoursPerYear', ((("rules"->>'accrualRate')::numeric) * 8))
       ELSE '{}'::jsonb END
  || CASE WHEN "rules" ? 'personalDaysPerYear'
       THEN jsonb_build_object('personalHoursPerYear', ((("rules"->>'personalDaysPerYear')::numeric) * 8))
       ELSE '{}'::jsonb END
  || CASE WHEN "rules" ? 'maxConsecutiveDays'
       THEN jsonb_build_object('maxConsecutiveHours', ((("rules"->>'maxConsecutiveDays')::numeric) * 8))
       ELSE '{}'::jsonb END
)
FROM "policies" p, "policy_types" pt
WHERE pr."policy_id" = p."id"
  AND p."policy_type_id" = pt."id"
  AND pt."key" = 'pto'
  AND ("rules" ? 'accrualRate' OR "rules" ? 'personalDaysPerYear' OR "rules" ? 'maxConsecutiveDays');
