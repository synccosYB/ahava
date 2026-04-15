CREATE TABLE IF NOT EXISTS "department_managers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "department_id" varchar NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "department_manager_unique" UNIQUE("department_id", "user_id")
);
--> statement-breakpoint
INSERT INTO "department_managers" ("department_id", "user_id")
SELECT "id", "manager_id" FROM "departments" WHERE "manager_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "departments" DROP COLUMN IF EXISTS "manager_id";
