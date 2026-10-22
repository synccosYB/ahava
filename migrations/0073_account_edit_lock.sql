-- Account edit-lock (chain of command). An owner/super-admin can lock an
-- account so it can't make edits; only someone at the locker's rank or higher
-- can unlock it (locked_by_rank). Additive and replay-safe. Does NOT change the
-- existing edit-permission gate — a separate, additive guard reads edit_locked.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "edit_locked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_by_user_id" varchar;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_by_rank" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
