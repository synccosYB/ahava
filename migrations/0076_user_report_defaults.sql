-- F7: per-user Reports defaults (preferred locations + departments the Reports
-- filter bar pre-fills). One row per user; arrays stored as jsonb id lists
-- (empty array = "all"). Additive and replay-safe.
CREATE TABLE IF NOT EXISTS "user_report_defaults" (
  "user_id" varchar PRIMARY KEY NOT NULL REFERENCES "users"("id"),
  "location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "department_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now()
);
