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

**Rebase tip — renaming a migration to dodge an idx collision:** `migrate.ts`
keys `_migration_log` by **tag** (filename), not idx. If main lands a migration
at the same idx as yours, `git mv` yours to the next free idx and rebuild the
journal. The DB still has a row for the OLD tag — that's harmless as long as the
SQL body is `IF NOT EXISTS` (the table/cols already exist). The new tag is unseen
so it applies on the next boot. A running instance that booted on the pre-rebase
journal will NOT have the new tags — restart the app (or it stays drifted).
