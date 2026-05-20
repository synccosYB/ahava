ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS exceeds_max_consecutive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS max_consecutive_at_submission REAL;
