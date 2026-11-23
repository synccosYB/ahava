-- Global idle auto-logout. idle_logout_minutes on the company (0 = disabled,
-- default 0 so nothing changes until an admin turns it on). Per-admin opt-out
-- on the user. A 60s "stay signed in?" warning fires before the actual logout.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "idle_logout_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "idle_logout_exempt" boolean DEFAULT false NOT NULL;
