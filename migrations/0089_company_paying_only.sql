-- A company that is a PAYING entity only (e.g. BCM) — hidden from the "working
-- company" pickers but still offered as a Paying Company. Default false so every
-- existing company keeps appearing everywhere.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "paying_company_only" boolean DEFAULT false NOT NULL;
