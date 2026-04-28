-- employee_pto_settings: rename override columns to *_hours_override and multiply existing values by 8
ALTER TABLE "employee_pto_settings" RENAME COLUMN "vacation_balance_override" TO "vacation_hours_override";
--> statement-breakpoint
UPDATE "employee_pto_settings" SET "vacation_hours_override" = "vacation_hours_override" * 8 WHERE "vacation_hours_override" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" RENAME COLUMN "sick_balance_override" TO "sick_hours_override";
--> statement-breakpoint
UPDATE "employee_pto_settings" SET "sick_hours_override" = "sick_hours_override" * 8 WHERE "sick_hours_override" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_pto_settings" RENAME COLUMN "personal_balance_override" TO "personal_hours_override";
--> statement-breakpoint
UPDATE "employee_pto_settings" SET "personal_hours_override" = "personal_hours_override" * 8 WHERE "personal_hours_override" IS NOT NULL;
--> statement-breakpoint

-- time_off_requests.balance_at_submission: integer -> real to preserve hour precision
ALTER TABLE "time_off_requests" ALTER COLUMN "balance_at_submission" TYPE real USING ("balance_at_submission"::real);
