-- Task #476: Reconcile dangling open punches (stuck clock-in state).
--
-- The "are you already clocked in?" guard (getCurrentAttendance) used to match
-- only status = 'in-progress', while the open-punch definition used everywhere
-- else (the partial unique index from migration 0048, the punch-integrity
-- validator, the clock-in/clock-out storage methods, the kiosk clock-out path)
-- is purely "clock_in IS NOT NULL AND clock_out IS NULL". The kiosk also stamps
-- its open punches with status 'present', not 'in-progress'.
--
-- That mismatch produced a stuck state: a row with clock_out NULL but a status
-- other than 'in-progress' was invisible to the 409 "already clocked in" guard,
-- so a new clock-in slipped past it only to be rejected with a 400 by the
-- integrity validator ("already has an open shift"), while clock-out claimed
-- "Not currently clocked in" — the employee was locked out of both actions.
--
-- The code fix makes getCurrentAttendance use the canonical predicate, so
-- detection no longer depends on status. This migration heals existing data so
-- the status column is consistent with that predicate. It is additive and
-- idempotent (replay-safe): re-running it changes nothing once normalized.

-- Step 1 — open punches (clock_in present, clock_out absent) whose status is
-- neither of the two legitimate open statuses ('in-progress' web / 'present'
-- kiosk). These are the dangling rows from an interrupted/auto clock-out or a
-- partially-written record. Normalize them to 'in-progress' so they are a
-- consistent, recognizable open shift the employee can clock out of. We do NOT
-- invent a clock_out — the shift stays open, just correctly labelled.
UPDATE punch_logs
SET status = 'in-progress'
WHERE clock_in IS NOT NULL
  AND clock_out IS NULL
  AND status NOT IN ('in-progress', 'present');
--> statement-breakpoint

-- Step 2 — the inverse: closed punches (clock_out present) still marked
-- 'in-progress'. A clean clock-out always stamps a finished status via the pay
-- engine, so this only happens on a partially-written/interrupted record. Give
-- them a finished status consistent with the engine's default daily OT
-- threshold (8h): 'overtime' when worked hours exceed it, otherwise 'complete'.
-- Historical pay snapshots are unaffected (this only repairs the status label).
UPDATE punch_logs
SET status = CASE
  WHEN COALESCE(hours_worked, 0) > 8 THEN 'overtime'
  ELSE 'complete'
END
WHERE clock_out IS NOT NULL
  AND status = 'in-progress';
