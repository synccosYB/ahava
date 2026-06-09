-- Task #315: Prevent duplicate open punches (clock-in race).
-- A double-tap on a kiosk, two devices, or a retried request on flaky Wi-Fi
-- could pass the "are you already clocked in?" check twice (the check and the
-- insert were not atomic) and create two open punches for one employee, which
-- corrupts hours / overtime / payroll. This migration enforces "at most one
-- open punch per employee" at the database level.
--
-- An "open punch" is a row with a clock-in but no clock-out
-- (clock_in IS NOT NULL AND clock_out IS NULL). Status is intentionally NOT
-- part of the predicate because the web path stamps "in-progress" while the
-- kiosk path stamps "present" for the same open state.
--
-- Additive and replay-safe: the cleanup is idempotent and the index uses
-- IF NOT EXISTS.

-- Step 1 — pre-migration cleanup. Collapse any pre-existing duplicate open
-- punches so the partial unique index below can be created. For each employee
-- with more than one open punch, keep the most recent one (the shift they are
-- presumably still in) and close the older ones as zero-length punches so they
-- no longer count as "open". We do NOT invent a clock-out time; older orphaned
-- open punches are closed at their own clock-in (0 hours) and flagged in notes
-- so payroll/HR can spot and correct them rather than silently inheriting bad
-- hours.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY employee_id
      ORDER BY clock_in DESC, created_at DESC, id DESC
    ) AS rn
  FROM punch_logs
  WHERE clock_out IS NULL AND clock_in IS NOT NULL
)
UPDATE punch_logs p
SET
  clock_out = p.clock_in,
  rounded_clock_out = COALESCE(p.rounded_clock_in, p.clock_in),
  hours_worked = 0,
  status = 'complete',
  notes = CASE
    WHEN p.notes IS NULL OR p.notes = '' THEN 'Auto-closed by migration 0048: duplicate open punch resolved.'
    ELSE p.notes || ' | Auto-closed by migration 0048: duplicate open punch resolved.'
  END
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;
--> statement-breakpoint

-- Step 2 — enforce one open punch per employee.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_punch_logs_one_open_per_employee"
  ON "punch_logs" ("employee_id")
  WHERE "clock_out" IS NULL AND "clock_in" IS NOT NULL;
