-- Exact time: stop rounding punches to the quarter hour (owner decision).
-- Going forward the default rounding rule is "none" (code). This migration
-- corrects already-recorded punches so historical timesheets/reports/payroll
-- show the exact clocked time too.
--
-- For every COMPLETED, non-missing punch (has a real clock-in AND a real
-- clock-out), set the rounded times equal to the actual punch times and
-- recompute hours_worked as the exact span minus breaks, to 2 decimals. This
-- matches server/punchHours.ts computePunchHoursWorked once rounding is off.
--
-- Left untouched: missing_clockout (its clock-out is only a placeholder),
-- missing_clockin, confirmation (0-hour daily markers), and in-progress punches
-- (no clock-out yet). Idempotent: re-running sets the same values.
--
-- The attendance ledger recomputes live from punches on every read, so
-- timesheets, reports and payroll reflect these corrected hours immediately;
-- the persisted hours rollup refreshes the next time each employee's ledger is
-- recomputed (any timesheet/report view).
UPDATE punch_logs
SET rounded_clock_in = clock_in,
    rounded_clock_out = clock_out,
    hours_worked = ROUND(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0
          - COALESCE(break_minutes, 0) / 60.0
      )::numeric,
      2
    )
WHERE clock_in IS NOT NULL
  AND clock_out IS NOT NULL
  AND status NOT IN ('missing_clockout', 'missing_clockin', 'confirmation');
