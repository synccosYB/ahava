CREATE TABLE IF NOT EXISTS "employee_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" varchar NOT NULL REFERENCES "users"("id"),
  "day_of_week" integer NOT NULL,
  "start_time" varchar(5) NOT NULL,
  "end_time" varchar(5) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_schedules_employee_day_idx" ON "employee_schedules" ("employee_id", "day_of_week");
