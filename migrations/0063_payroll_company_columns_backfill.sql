-- Task #475 follow-up / repair.
-- Migration 0060_payroll_company_per_employee was recorded as applied in the
-- production database during the deploy where two migrations briefly shared the
-- 0060 number, but its payroll-company columns never actually landed there. Once
-- a tag is in "_migration_log" the boot runner skips it forever, so 0060 can no
-- longer self-heal. This corrective migration re-adds the same columns under a
-- fresh tag so it runs on the next deploy.
--
-- Columns are added FIRST and SEPARATELY from their foreign keys: the boot
-- drift-guard only checks for column existence, so this guarantees the columns
-- land (and the app boots) even if a constraint step has trouble. The FKs are
-- then added in guarded blocks for parity with development. Fully idempotent /
-- replay-safe.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "payroll_company_id" varchar;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "payroll_company_id" varchar;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "payroll_company_name" varchar(255);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_employment_profiles_payroll_company_id_companies_id_fk'
  ) THEN
    ALTER TABLE "user_employment_profiles"
      ADD CONSTRAINT "user_employment_profiles_payroll_company_id_companies_id_fk"
      FOREIGN KEY ("payroll_company_id") REFERENCES "companies"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_batch_records_payroll_company_id_companies_id_fk'
  ) THEN
    ALTER TABLE "payroll_batch_records"
      ADD CONSTRAINT "payroll_batch_records_payroll_company_id_companies_id_fk"
      FOREIGN KEY ("payroll_company_id") REFERENCES "companies"("id");
  END IF;
END $$;
