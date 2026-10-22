-- Org-structure + pay model changes (Notes #1–#5).
--  * department_locations: which departments exist at which location (M2M).
--    Replaces the single departments.location_id tie; backfilled from it below.
--  * manager_scopes: a manager's "hats" — each row is one (location?, department?)
--    pair. Visible employees = UNION across a manager's hats (see
--    storage.getScopedUserIds). Empty = fall back to legacy membership scoping.
--  * user_employment_profiles.clock_in_required: when false, the person is NOT
--    required to punch, and missing-clock-out / no-show alerts are suppressed.
-- Additive and replay-safe (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS "department_locations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "department_id" varchar NOT NULL,
  "location_id" varchar NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_locations_unique" ON "department_locations" ("department_id","location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_department_locations_department" ON "department_locations" ("department_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_department_locations_location" ON "department_locations" ("location_id");
--> statement-breakpoint
-- Backfill: every department that had a single legacy location keeps it.
INSERT INTO "department_locations" ("department_id","location_id")
SELECT "id","location_id" FROM "departments" WHERE "location_id" IS NOT NULL
ON CONFLICT ("department_id","location_id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manager_scopes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "location_id" varchar,
  "department_id" varchar,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_manager_scopes_user" ON "manager_scopes" ("user_id");
--> statement-breakpoint
-- A hat must name at least one dimension; a row with both null is meaningless.
CREATE UNIQUE INDEX IF NOT EXISTS "manager_scopes_unique" ON "manager_scopes" ("user_id", COALESCE("location_id",''), COALESCE("department_id",''));
--> statement-breakpoint
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "clock_in_required" boolean DEFAULT true NOT NULL;
