---
name: Schema drift guardrail
description: How the boot-time migration safety check detects model-vs-DB drift, and why it's derived from Drizzle models.
---
# Schema drift guardrail

The post-migration check in `server/migrate.ts` (`verifySchema`) compares the live DB against the Drizzle models in `shared/schema.ts`, deriving expected tables/columns via `getTableConfig` (logic in `server/schemaDrift.ts`). Missing table/column → boot throws.

**Why:** the old check used a hand-maintained `REQUIRED_TABLES`/`REQUIRED_COLUMNS` list that silently rotted whenever a model gained a field but the list wasn't updated — exactly the schema-vs-migration drift this project has hit in production.

**How to apply:**
- Editing a model means you MUST run `npx drizzle-kit generate` and commit the migration, or the app refuses to boot (locally AND prod). This is intended.
- Scope is presence-only (tables + columns); it does NOT diff types/nullability/defaults, and does NOT flag extra DB columns (legacy columns are tolerated).
- Standalone CI/release gate: `npx tsx scripts/check-schema-drift.ts` (exits non-zero on drift). Unit test: `server/__tests__/schemaDrift.test.ts` (pure `computeDrift`, no DB needed).
- `_migration_log` is runtime-only and excluded from the expected shape.
- Full release/rollback/feature-flag runbook: `docs/deployment-safety.md`.
