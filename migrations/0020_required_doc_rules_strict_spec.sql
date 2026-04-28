ALTER TABLE "required_document_rules" DROP COLUMN IF EXISTS "created_by";
--> statement-breakpoint
ALTER TABLE "required_document_rules" DROP COLUMN IF EXISTS "updated_at";
--> statement-breakpoint
ALTER TABLE "required_document_rules" ALTER COLUMN "due_offset_days" SET DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "required_document_rules" ALTER COLUMN "scope_type" DROP DEFAULT;
EXCEPTION WHEN others THEN NULL;
END $$;
