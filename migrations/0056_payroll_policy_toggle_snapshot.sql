-- Task #84 follow-through: freeze the on/off toggles and the holiday
-- determination onto each payroll batch record. The numeric snapshot added in
-- 0055 (thresholds, multipliers, rate) was not enough on its own to recompute a
-- closed period IDENTICALLY: reconciliation still had to read the live policy
-- toggles (autoCalculateOT / overtimeEnabled / doubleTimeEnabled /
-- holidayOtExclusion) and the employee's CURRENT schedule to decide holidays,
-- both of which can change after export and produce false drift. Snapshotting
-- them here makes historical verification depend ONLY on persisted inputs.
-- All columns are additive and nullable, so this migration is replay-safe;
-- legacy rows keep NULL and consumers fall back to the live effective policy.
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "auto_calculate_ot" boolean;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "overtime_enabled" boolean;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "double_time_enabled" boolean;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "holiday_ot_exclusion" boolean;
--> statement-breakpoint
ALTER TABLE "payroll_batch_records"
  ADD COLUMN IF NOT EXISTS "is_holiday" boolean;
