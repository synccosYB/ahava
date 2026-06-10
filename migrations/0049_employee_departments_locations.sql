-- Task #383 (BUG-0240): employees can belong to MULTIPLE departments & locations.
-- Adds two join tables and backfills them from the existing single-value
-- columns (users.department_id / users.location_id). The legacy columns stay in
-- place as a compatibility shim (populated with one of the assignments).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "employee_departments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "department_id" varchar NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "employee_departments_unique" UNIQUE ("user_id", "department_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "IDX_employee_departments_user"
  ON "employee_departments" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_employee_departments_department"
  ON "employee_departments" ("department_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "employee_locations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "location_id" varchar NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "employee_locations_unique" UNIQUE ("user_id", "location_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "IDX_employee_locations_user"
  ON "employee_locations" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_employee_locations_location"
  ON "employee_locations" ("location_id");
--> statement-breakpoint

-- Backfill: every existing single department/location assignment becomes a join row.
INSERT INTO "employee_departments" ("user_id", "department_id")
SELECT u."id", u."department_id"
FROM "users" u
WHERE u."department_id" IS NOT NULL
ON CONFLICT ON CONSTRAINT "employee_departments_unique" DO NOTHING;
--> statement-breakpoint

INSERT INTO "employee_locations" ("user_id", "location_id")
SELECT u."id", u."location_id"
FROM "users" u
WHERE u."location_id" IS NOT NULL
ON CONFLICT ON CONSTRAINT "employee_locations_unique" DO NOTHING;
