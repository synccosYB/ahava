-- Per-employee "required to clock out for lunch" flag. Default false. When true,
-- the payroll ledger applies lunch rules: a lunch taken by clocking out and back
-- within the hour is paid (up to 45 min); an employee who does not take a proper
-- lunch (worked straight through, or clocked out and forgot to clock back in) is
-- docked a flat 45-minute lunch on a shift long enough to owe one. Additive and
-- replay-safe.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "require_lunch_break" boolean DEFAULT false NOT NULL;
