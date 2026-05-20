-- Task #235: DB-level safety net for time_off_requests hours columns.
--
-- Background: hours_requested / hours_approved were stored as raw `real` with
-- no DB constraint. Task #230 fixed the API + balance reducer so corrupt
-- values (NaN, Infinity, 4.25e+37, negatives, zero) can no longer be written
-- through our code paths, but a direct-SQL fix, future migration, or
-- third-party integration could still re-introduce them and poison the
-- running balance. This migration enforces the same invariant at the DB
-- level so the rule travels with the schema.
--
-- The shared cap (MAX_TIME_OFF_HOURS_PER_REQUEST = 2000 in shared/schema.ts)
-- is mirrored here. If that value ever changes, follow up with a new
-- migration that drops + re-adds these constraints with the new bound.
--
-- Safe to re-run: defensive cleanup is idempotent, and the CHECK constraints
-- are wrapped in DO blocks that skip when they already exist.

-- 1. Defensively repair any rows that would violate the new constraints.
--    Mirrors POST /api/time-off/cleanup-invalid-hours: invalid hoursRequested
--    is reset to the implied business-day hours for the request's date range
--    (clamped to [8, 2000]); invalid hoursApproved is nulled out.
--    NaN / Infinity fail every numeric comparison, so the NOT(... > 0 AND ... <= 2000)
--    filter catches them along with negatives, zero, and absurdly large values.
UPDATE "time_off_requests"
SET "hours_requested" = LEAST(
  GREATEST(
    8,
    (
      SELECT COUNT(*)::int * 8
      FROM generate_series("time_off_requests"."start_date"::timestamp,
                           "time_off_requests"."end_date"::timestamp,
                           interval '1 day') AS d(day)
      WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
    )
  ),
  2000
)::real
WHERE NOT ("hours_requested" > 0 AND "hours_requested" <= 2000);
--> statement-breakpoint
UPDATE "time_off_requests"
SET "hours_approved" = NULL
WHERE "hours_approved" IS NOT NULL
  AND NOT ("hours_approved" > 0 AND "hours_approved" <= 2000);
--> statement-breakpoint
-- 2. Add CHECK constraints (idempotent via DO blocks).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'time_off_requests_hours_requested_check'
  ) THEN
    ALTER TABLE "time_off_requests"
      ADD CONSTRAINT "time_off_requests_hours_requested_check"
      CHECK ("hours_requested" > 0 AND "hours_requested" <= 2000);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'time_off_requests_hours_approved_check'
  ) THEN
    ALTER TABLE "time_off_requests"
      ADD CONSTRAINT "time_off_requests_hours_approved_check"
      CHECK ("hours_approved" IS NULL OR ("hours_approved" > 0 AND "hours_approved" <= 2000));
  END IF;
END $$;
