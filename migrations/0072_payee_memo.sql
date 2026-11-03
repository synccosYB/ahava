-- Note #5 (1099 payee): a free-text MEMO for the payee, shown on the payroll
-- report sent to the paying companies (e.g. a check memo / note). Additive and
-- replay-safe.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "payee_memo" varchar(500);
