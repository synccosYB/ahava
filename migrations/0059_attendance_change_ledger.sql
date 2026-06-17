-- Immutable, append-only attendance & payroll ledger.
-- Records every attendance/PTO/payroll-impacting change with before/after
-- snapshots and (where applicable) the net hours delta. Separate from
-- `audit_logs` and `punch_logs`. INSERT-only at the application layer.
-- Idempotent / replay-safe: guarded with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "attendance_change_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sequence" bigserial NOT NULL,
  "category" varchar(20) NOT NULL,
  "event_type" varchar(60) NOT NULL,
  "employee_id" varchar NOT NULL,
  "actor_user_id" varchar,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" varchar(255),
  "work_date" date,
  "hours_delta" real,
  "before_value" jsonb,
  "after_value" jsonb,
  "context" jsonb,
  "source" varchar(30),
  "ip_address" varchar(45),
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_change_ledger_employee_id_users_id_fk'
  ) THEN
    ALTER TABLE "attendance_change_ledger"
      ADD CONSTRAINT "attendance_change_ledger_employee_id_users_id_fk"
      FOREIGN KEY ("employee_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_change_ledger_actor_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "attendance_change_ledger"
      ADD CONSTRAINT "attendance_change_ledger_actor_user_id_users_id_fk"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "attendance_change_ledger_employee_id_idx" ON "attendance_change_ledger" ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_change_ledger_category_idx" ON "attendance_change_ledger" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_change_ledger_entity_id_idx" ON "attendance_change_ledger" ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_change_ledger_work_date_idx" ON "attendance_change_ledger" ("work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_change_ledger_created_at_idx" ON "attendance_change_ledger" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_change_ledger_sequence_idx" ON "attendance_change_ledger" ("sequence");
