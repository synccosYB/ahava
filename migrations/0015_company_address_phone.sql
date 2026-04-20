-- Ensure companies has the address/phone columns required by the Divisions UI.
-- The shared schema declares these columns but earlier installs were missing
-- them, which broke GET /api/companies and the "Add Division" flow with 500s.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address" varchar(500);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "phone" varchar(30);
--> statement-breakpoint
-- The shared schema declares a separate location_addresses table that the
-- storage layer reads/writes. Make sure it exists so the Locations admin
-- pages don't blow up on fresh installs.
CREATE TABLE IF NOT EXISTS "location_addresses" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "location_id" varchar NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "label" varchar(100),
  "address" varchar(500),
  "city" varchar(100),
  "state" varchar(50),
  "zip" varchar(20)
);
