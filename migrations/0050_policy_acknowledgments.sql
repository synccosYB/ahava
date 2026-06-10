-- Task #394: Policies tab — real effective dates on assignments + policy acknowledgments.
-- All statements are idempotent (IF NOT EXISTS) so this migration is replay-safe.

ALTER TABLE "policy_assignments"
  ADD COLUMN IF NOT EXISTS "effective_date" timestamp;
--> statement-breakpoint

ALTER TABLE "policies"
  ADD COLUMN IF NOT EXISTS "requires_acknowledgment" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "policy_acknowledgments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "policy_id" varchar NOT NULL REFERENCES "policies"("id"),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "policy_version" integer NOT NULL,
  "acknowledged_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "policy_acknowledgments_unique" UNIQUE ("policy_id", "user_id", "policy_version")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "IDX_policy_acknowledgments_user"
  ON "policy_acknowledgments" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "IDX_policy_acknowledgments_policy"
  ON "policy_acknowledgments" ("policy_id");
