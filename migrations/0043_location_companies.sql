-- Task #258: locations can belong to multiple companies.
-- Adds a join table and backfills it from the existing single-company link.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "location_companies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "location_id" varchar NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "company_id" varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "location_companies_unique" UNIQUE ("location_id", "company_id")
);

CREATE INDEX IF NOT EXISTS "IDX_location_companies_company"
  ON "location_companies" ("company_id");
CREATE INDEX IF NOT EXISTS "IDX_location_companies_location"
  ON "location_companies" ("location_id");

-- Backfill: every existing location's primary companyId becomes a join row.
INSERT INTO "location_companies" ("location_id", "company_id")
SELECT l."id", l."company_id"
FROM "locations" l
WHERE l."company_id" IS NOT NULL
ON CONFLICT ON CONSTRAINT "location_companies_unique" DO NOTHING;
