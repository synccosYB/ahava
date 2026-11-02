-- Termination reason captured when an employee account is deactivated
-- (Resigned / Fired / Laid off / Other). Additive and replay-safe; nullable so
-- active accounts and legacy deactivations (predating this field) stay null.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termination_reason" varchar(30);
