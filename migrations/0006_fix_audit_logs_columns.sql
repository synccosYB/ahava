-- Fix audit_logs table: ensure id and actor_user_id are varchar (not integer)
-- This handles the case where the table was created with integer columns
-- before migration 0002_schema_sync could apply the correct schema.
-- Existing data is preserved by casting integer values to text.

-- Step 1: Drop any foreign key constraints on audit_logs that reference integer columns
DO $$ BEGIN
  ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_performed_by_users_id_fk";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_user_id_users_id_fk";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint

-- Step 2: Check if id column is integer and alter it to varchar, preserving existing data
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'audit_logs' AND column_name = 'id';

  IF col_type = 'integer' OR col_type = 'bigint' THEN
    ALTER TABLE "audit_logs" ALTER COLUMN "id" DROP DEFAULT;
    ALTER TABLE "audit_logs" ALTER COLUMN "id" TYPE varchar USING id::text;
    ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
  END IF;
END $$;
--> statement-breakpoint

-- Step 3: Check if actor_user_id column is integer and alter it to varchar, preserving existing data
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'audit_logs' AND column_name = 'actor_user_id';

  IF col_type = 'integer' OR col_type = 'bigint' THEN
    ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_id" TYPE varchar USING actor_user_id::text;
  END IF;
END $$;
--> statement-breakpoint

-- Step 4: Ensure actor_user_id column exists (in case it was named differently)
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_user_id" varchar;
--> statement-breakpoint

-- Step 5: Nullify any actor_user_id values that don't reference valid users
-- (legacy integer-cast values won't match UUID user IDs)
UPDATE "audit_logs" SET "actor_user_id" = NULL
WHERE "actor_user_id" IS NOT NULL
  AND "actor_user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint

-- Step 6: Re-add the foreign key constraint
DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
