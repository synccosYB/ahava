---
name: Migrations are hand-written, not drizzle-generated
description: How to add a schema column/table migration in this repo without breaking everything.
---

# Migrations are hand-written here — do NOT rely on `drizzle-kit generate`

The Drizzle meta snapshot is frozen at `0000` while `migrations/0001`–`00NN`
are all hand-authored SQL. Running `npx drizzle-kit generate` prompts
interactively about table renames and would try to recreate the entire schema.

**Why:** the snapshot was never kept in sync; only `0000_snapshot.json` exists
in `migrations/meta/`. Generate compares the live model against that ancient
snapshot, so it sees nearly every table as "new".

**How to apply (the working convention):**
1. Edit the model in `shared/schema.ts` (or `shared/models/auth.ts`).
2. Hand-write `migrations/00NN_<name>.sql` using `ALTER TABLE ... ADD COLUMN
   IF NOT EXISTS ...` (additive, replay-safe; statements separated by
   `--> statement-breakpoint`).
3. Append an entry to `migrations/meta/_journal.json` (`idx`, `version:"7"`,
   `when`, `tag` = filename without `.sql`, `breakpoints:true`).
4. Restart the app — `server/migrate.ts` applies pending tags at boot, then
   `verifySchema()` derives expected columns from the Drizzle models and throws
   if the DB is missing any. So model + migration MUST land together or boot fails.
5. Confirm with `npx tsx scripts/check-schema-drift.ts` ("No schema drift").
