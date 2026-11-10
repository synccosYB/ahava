-- Optional employee contact phone. Nullable; no format enforced.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(30);
