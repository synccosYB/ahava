-- Task #477: Use one consistent label for an in-progress shift everywhere.
--
-- The web clock-in path stamped an open shift with status 'in-progress' while
-- the kiosk (and the admin forgotten-clock-in correction) stamped the same open
-- state as 'present'. Detection no longer keys on status (it uses the canonical
-- "clock_in IS NOT NULL AND clock_out IS NULL" predicate everywhere, see task
-- #476 / migration 0061), so the divergence is no longer a stuck-state bug — but
-- the inconsistent label still makes reports, filters, and any future
-- status-based logic confusing and error-prone.
--
-- The code fix makes every clock-in path (web, kiosk, admin correction,
-- re-opened punch) stamp 'in-progress', and the column default is now
-- 'in-progress'. This migration heals existing data and the column default so
-- they agree with that single label. It is additive and idempotent
-- (replay-safe): re-running it changes nothing once normalized.

-- Step 1 — relabel any OPEN punch (clock_in present, clock_out absent) currently
-- marked 'present' (legacy kiosk / admin-correction rows) to the single open
-- label 'in-progress'. We do NOT touch clock_out — the shift stays open, just
-- consistently labelled. Closed punches keep their finished status untouched.
UPDATE punch_logs
SET status = 'in-progress'
WHERE clock_in IS NOT NULL
  AND clock_out IS NULL
  AND status = 'present';
--> statement-breakpoint

-- Step 2 — make the column default consistent with the open-shift label so any
-- future insert that omits status records an open punch as 'in-progress' rather
-- than the old 'present'. Idempotent: setting the same default twice is a no-op.
ALTER TABLE punch_logs ALTER COLUMN status SET DEFAULT 'in-progress';
