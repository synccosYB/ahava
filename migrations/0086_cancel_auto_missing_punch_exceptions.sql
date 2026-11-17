-- One-off backlog cleanup for the missing-punch corrections redesign.
--
-- Missing punches are now DETECTED on the punch (and shown on the timesheet) but
-- are no longer AUTO-flagged as a pending approval item — a correction is raised
-- only when the employee requests one. Cancel the existing pending auto-detected
-- missing-punch review items so the Requests & Approvals badge/queue reflects the
-- new model.
--
-- Scope: ONLY the two auto-detected missing-punch types. Employee-submitted
-- correction types (missing_punch, time_correction, forgotten_clock_in,
-- forgotten_clock_out, punch_removal) and other review types
-- (long_shift_approval, geofence, punch_overlap, max_shift_split) are left alone.
-- The underlying punches keep their missing status, so nothing disappears from
-- the timesheet.
UPDATE "attendance_exceptions"
SET "status" = 'cancelled',
    "reviewed_at" = now(),
    "review_notes" =
      CASE WHEN COALESCE("review_notes", '') = '' THEN '' ELSE "review_notes" || E'\n' END
      || '[Auto-closed: missing punches are no longer auto-flagged for approval; raise a correction request to fix one.]'
WHERE "status" = 'pending'
  AND "type" IN ('missing_clockout', 'missing_clockin');
