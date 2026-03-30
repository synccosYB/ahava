ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "force_password_change" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "document_type" varchar(50) NOT NULL,
  "file_name" varchar(500) NOT NULL,
  "file_path" varchar(1000) NOT NULL,
  "mime_type" varchar(100),
  "file_size" integer,
  "status" varchar(20) DEFAULT 'uploaded' NOT NULL,
  "uploaded_by" varchar REFERENCES "users"("id"),
  "uploaded_at" timestamp DEFAULT now(),
  "reviewed_by" varchar REFERENCES "users"("id"),
  "reviewed_at" timestamp
);
