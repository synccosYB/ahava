-- Per-employee "trust the clock's In/Out key" flag. Default false: direction is
-- derived from open-shift state (device status code ignored). When true, a
-- biometric punch is recorded as clock-in or clock-out per what the employee
-- pressed on the device, so one forgotten punch no longer flips every punch
-- after it. Additive and replay-safe.
ALTER TABLE "user_employment_profiles" ADD COLUMN IF NOT EXISTS "use_device_punch_direction" boolean DEFAULT false NOT NULL;
