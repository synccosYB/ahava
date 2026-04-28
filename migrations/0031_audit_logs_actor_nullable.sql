-- Allow `audit_logs.actor_user_id` to be NULL so we can record system-attributed
-- audit events (e.g. password-reset attempts for unknown emails / unknown
-- tokens, or attempts that occur before any user has been authenticated).
ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_id" DROP NOT NULL;
