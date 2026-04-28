CREATE TABLE IF NOT EXISTS "workflows" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(200) NOT NULL,
  "policy_type_id" varchar,
  "trigger_type" varchar(100) NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "node_graph" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "workflows" ADD CONSTRAINT "workflows_policy_type_id_policy_types_id_fk"
    FOREIGN KEY ("policy_type_id") REFERENCES "policy_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
