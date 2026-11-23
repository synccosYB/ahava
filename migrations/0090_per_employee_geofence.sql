-- Per-employee geofence exemption: when true, the employee may clock in/out from
-- their phone anywhere (the self-service geofence radius no longer blocks them).
-- Default false — no existing employee's behavior changes.
ALTER TABLE "user_employment_profiles"
  ADD COLUMN IF NOT EXISTS "geofence_exempt" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Clock-OUT GPS + per-punch "off-site" markers (clock-in GPS already lives in
-- punch_latitude / punch_longitude). Off-site = the punch's location was outside
-- the employee's geofence radius; it is a display badge only, nothing is blocked.
ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "clock_out_latitude" real;
--> statement-breakpoint
ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "clock_out_longitude" real;
--> statement-breakpoint
ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "clock_in_off_site" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "punch_logs"
  ADD COLUMN IF NOT EXISTS "clock_out_off_site" boolean DEFAULT false NOT NULL;
