-- Task #222: Stop duplicate employee emails that only differ in casing.
-- 1) Backfill: trim + lowercase every existing users.email so it matches
--    what the app will write going forward.
-- 2) Resolve casing collisions deterministically: for each lowercased value,
--    keep the most recently updated row (falling back to created_at, then id
--    so the choice is stable on re-run). Other duplicate rows have their
--    email rewritten to a clearly-marked placeholder so the migration can
--    create a case-insensitive unique index without conflict. The placeholder
--    embeds the user id so it stays unique and HR can find the rows later.
-- 3) Replace the case-sensitive users_email_unique constraint with a
--    case-insensitive unique index on lower(email).
-- Idempotent: re-running on already-normalized data is a no-op.
UPDATE users
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND email <> lower(btrim(email));
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    email,
    row_number() OVER (
      PARTITION BY email
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM users
  WHERE email IS NOT NULL
)
UPDATE users u
SET email = 'duplicate+' || u.id || '+' || u.email
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;
--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email));
