-- Self-service password reset tokens. Issued by /api/auth/forgot-password
-- and /api/users/:id/reset-password (mode=emailLink). Stores SHA-256
-- hash of the token (never the raw token) so a DB leak does not yield
-- usable reset links. Single-use, expires in 1 hour. Safe to re-run.

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL,
  "token_hash" varchar(128) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "requested_ip" varchar(45),
  "created_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_token_hash_unique"
    UNIQUE ("token_hash");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_user"
  ON "password_reset_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_expires"
  ON "password_reset_tokens" ("expires_at");
