---
name: Migration runner recovery & gotchas
description: How the boot-time migration runner can "burn" a tag without applying it, and how to recover; plus dev-staleness gotcha.
---

# Boot migration runner: burned tags & recovery

The app runs hand-written SQL migrations at boot via `server/migrate.ts`, tracked
by `tag` in the `_migration_log` table. A tag already in `_migration_log` is
**skipped forever**.

## Failure mode: "recorded applied but columns missing"
The runner records a migration as applied if every statement either succeeded OR
threw an *idempotent* error code (duplicate column/table/object, unique
violation). If a migration's real DDL never takes effect but only throws
idempotent-looking errors (or the file content under that tag was wrong — e.g. a
transient duplicate migration-number collision during a parallel deploy), the tag
gets logged while the schema change never lands. The boot drift-guard
(`verifySchema`, derived from `shared/schema.ts`) then throws on the next deploy,
crashing startup → healthcheck fails → **publish fails**.

This actually happened: two tasks briefly shared migration number `0060`; in
production `0060_payroll_company_per_employee` was logged but its
`payroll_company_id`/`payroll_company_name` columns never landed.

## Recovery (the ONLY safe path)
- **Never** edit/delete rows in `_migration_log`, and **never** run DDL directly
  against production (prod `executeSql` is read-only by design).
- Add a **NEW migration tag** (next idx in `migrations/meta/_journal.json`) that
  re-applies the change idempotently. A fresh tag runs on the next deploy boot.
- **Add columns BEFORE (and separately from) their FK constraints.** The boot
  drift-guard checks column *existence* only, so plain `ADD COLUMN IF NOT EXISTS`
  guarantees boot succeeds even if a constraint step has trouble; add FKs after in
  guarded `DO $$ ... IF NOT EXISTS (pg_constraint) ... $$` blocks.
- Then tell the user to **Publish again** — that's what runs the new migration in prod.

**Why:** a burned tag cannot self-heal; bundling the FK into the column-add is
exactly what lets an FK error get idempotent-swallowed and strand the column.

## Dev-staleness gotcha
The dev workflow runs `tsx server/index.ts` with **no --watch**, so the server
process (and `migrate.ts`) only re-runs on a **workflow restart**, not on task
merges or HMR. After merges that add migrations, dev DB/schema can lag until you
restart "Start application". A passing dev drift-check can therefore reflect OLD
schema — restart dev before trusting it to reproduce a prod schema problem.
