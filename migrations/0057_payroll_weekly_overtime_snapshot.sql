-- Weekly overtime (task #452): the pay engine now reclassifies regular hours
-- over the weekly threshold into overtime. To keep CLOSED payroll periods
-- version-stable, freeze the weekly-OT inputs onto each batch record alongside
-- the daily snapshot (0055/0056): the weekly threshold, the on/off switch, and
-- the configured workweek start day. Reconciliation reads these back and groups
-- the batch's rows by workweek to recompute the SAME weekly split.
-- All columns are additive and nullable, so this migration is replay-safe;
-- legacy rows keep NULL and recompute daily-only (weekly OT disabled), which
-- preserves the dollars already exported before weekly OT existed.
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "ot_threshold_weekly" real;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "weekly_overtime_enabled" boolean;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "workweek_start_day" integer;
