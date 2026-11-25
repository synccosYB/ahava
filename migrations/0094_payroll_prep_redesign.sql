-- Payroll Prep redesign: batch send-state, export versioning, location
-- scoping, the unified Adjustments box, and saved batch defaults.

-- 1) payroll_exports: "sent to payroll company" state, export version
--    counter, a "changed since last export" flag, and the work location(s)
--    this batch covers. All defaulted so existing batches are unaffected.
ALTER TABLE "payroll_exports"
  ADD COLUMN IF NOT EXISTS "sent_to_payroll_at" timestamp,
  ADD COLUMN IF NOT EXISTS "sent_to_payroll_by" varchar REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "export_version" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "changed_since_export" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

-- 2) A log of every export/send a batch produced, so "Exported ×2 (change in
--    the 2nd)" is auditable. One row per generated file set.
CREATE TABLE IF NOT EXISTS "payroll_export_versions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payroll_export_id" varchar NOT NULL REFERENCES "payroll_exports"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "kind" varchar(20) NOT NULL,
  "note" text,
  "record_count" integer DEFAULT 0,
  "generated_at" timestamp DEFAULT now(),
  "generated_by" varchar REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_export_versions_export_idx"
  ON "payroll_export_versions" ("payroll_export_id");
--> statement-breakpoint

-- 3) payroll_adjustments: the unified Adjustments box. An item carries its
--    kind, who raised it (admin vs manager), the admin's routing choice, and
--    where it was ultimately applied.
--      kind:        backpay | held_back_fixed | edit_after_sent
--      created_by_role: admin | manager | employee
--      route_choice: add_to_sent | next_period   (null until the admin decides)
ALTER TABLE "payroll_adjustments"
  ADD COLUMN IF NOT EXISTS "kind" varchar(24) DEFAULT 'edit_after_sent' NOT NULL,
  ADD COLUMN IF NOT EXISTS "created_by_role" varchar(20),
  ADD COLUMN IF NOT EXISTS "created_by" varchar REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "route_choice" varchar(20),
  ADD COLUMN IF NOT EXISTS "routed_to_export_id" varchar REFERENCES "payroll_exports"("id");
--> statement-breakpoint

-- 4) Saved batch defaults (org-wide singleton, keyed by scope): which
--    location(s) the admin usually batches, and whether each payroll company
--    gets one combined report across locations or a separate report per
--    location on "Send to Payroll Company".
CREATE TABLE IF NOT EXISTS "payroll_batch_defaults" (
  "scope" varchar PRIMARY KEY DEFAULT 'global' NOT NULL,
  "location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "report_split_by_location" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now(),
  "updated_by" varchar REFERENCES "users"("id")
);
