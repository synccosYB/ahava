CREATE TABLE IF NOT EXISTS "certifications" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "name" varchar(200) NOT NULL,
  "issuer" varchar(200),
  "issue_date" date,
  "expiration_date" date,
  "document_id" varchar REFERENCES "documents"("id"),
  "notes" text,
  "status" varchar(20) NOT NULL DEFAULT 'valid',
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certifications_employee_id_idx" ON "certifications" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certifications_expiration_date_idx" ON "certifications" ("expiration_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certifications_status_idx" ON "certifications" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "required_document_rules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_type" varchar(50) NOT NULL,
  "scope_type" varchar(20) NOT NULL DEFAULT 'global',
  "company_id" varchar REFERENCES "companies"("id"),
  "location_id" varchar REFERENCES "locations"("id"),
  "department_id" varchar REFERENCES "departments"("id"),
  "user_id" varchar REFERENCES "users"("id"),
  "due_offset_days" integer NOT NULL DEFAULT 30,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "required_document_rules_doc_scope_idx" ON "required_document_rules" ("document_type", "scope_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "required_document_rules_active_idx" ON "required_document_rules" ("is_active");
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "employee_id" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "details" jsonb;
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "acknowledged_by" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp;
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "resolved_by" varchar REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "system_alerts" ALTER COLUMN "message" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_alerts" ALTER COLUMN "severity" SET DEFAULT 'medium';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_alerts' AND column_name = 'title'
  ) THEN
    EXECUTE 'ALTER TABLE "system_alerts" ALTER COLUMN "title" DROP NOT NULL';
  END IF;
END
$$;
