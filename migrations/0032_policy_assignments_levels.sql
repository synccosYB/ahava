ALTER TABLE "policy_assignments" ADD COLUMN IF NOT EXISTS "role_id" varchar;
--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD COLUMN IF NOT EXISTS "employment_type" varchar(30);
--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD COLUMN IF NOT EXISTS "pay_type" varchar(20);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
