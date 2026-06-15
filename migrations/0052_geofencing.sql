-- Task #418: address geocoding (SerpApi) + clock-in geofencing.
-- Adds latitude/longitude to companies and location addresses, per-address
-- geofence config, and punch coordinates captured at clock-in.
-- Additive and safe to re-run.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "latitude" real;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "longitude" real;
--> statement-breakpoint

ALTER TABLE "location_addresses" ADD COLUMN IF NOT EXISTS "latitude" real;
--> statement-breakpoint
ALTER TABLE "location_addresses" ADD COLUMN IF NOT EXISTS "longitude" real;
--> statement-breakpoint
ALTER TABLE "location_addresses" ADD COLUMN IF NOT EXISTS "geofence_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "location_addresses" ADD COLUMN IF NOT EXISTS "geofence_radius_meters" integer DEFAULT 150 NOT NULL;
--> statement-breakpoint

ALTER TABLE "punch_logs" ADD COLUMN IF NOT EXISTS "punch_latitude" real;
--> statement-breakpoint
ALTER TABLE "punch_logs" ADD COLUMN IF NOT EXISTS "punch_longitude" real;
