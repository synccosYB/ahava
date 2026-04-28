-- Rename time_off_balances columns from days to hours.
-- Existing values are already stored in hours after the prior PTO conversion;
-- this is a pure column rename to make column names match the unit.
-- Wrapped in DO blocks so the migration is idempotent and safe to re-run
-- when the columns have already been renamed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_off_balances' AND column_name = 'total_days'
  ) THEN
    ALTER TABLE "time_off_balances" RENAME COLUMN "total_days" TO "total_hours";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_off_balances' AND column_name = 'used_days'
  ) THEN
    ALTER TABLE "time_off_balances" RENAME COLUMN "used_days" TO "used_hours";
  END IF;
END $$;
