-- Task #84: single authoritative attendance/pay engine.
-- Payroll batch records now carry (a) a double_time_hours bucket so double-time
-- is actually paid, and (b) a frozen snapshot of the pay-affecting policy values
-- (OT/DT thresholds, OT/DT multipliers, hourly rate, policy version) so a
-- historical payroll period recomputes IDENTICALLY even after the live policy is
-- later edited. All columns are additive and nullable (double_time_hours
-- defaults to 0), so this migration is fully replay-safe.
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "double_time_hours" real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "ot_threshold_daily" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "double_time_threshold_daily" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "overtime_multiplier" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "double_time_multiplier" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "hourly_rate" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "policy_version" integer;
