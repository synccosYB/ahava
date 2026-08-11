One-shot production data wipe trigger (Task 522).

While this file exists, the NEXT production deployment boot will:
  1. Take a pg_dump backup, verify it, upload it to object storage
  2. Truncate all application tables (schema + _migration_log preserved)
  3. Re-seed the bootstrap admin via the normal startup seed

It runs at most once (guarded by the 9999_prod_data_wipe_2026_08_11 marker
in _migration_log) and is ignored outside Replit deployments, so it can
never wipe the development database. Delete this file after the wipe.
