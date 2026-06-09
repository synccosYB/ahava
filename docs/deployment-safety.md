# Deployment, Rollback & Migration Safety

This is the reviewed release-safety runbook for the Ahava Time & Attendance system.
It covers how releases roll out, how to roll back the app and the schema when a
release goes bad, how migrations are kept safe and reversible, when risky changes
ship behind a feature flag, and the checklist to run before any schema-changing
deploy.

> Out of scope here: backup/restore strategy (tracked separately) and a full
> CI/CD build-out (recommended below, not built here).

---

## 1. How releases work today

- **Hosting:** the app runs on Replit. The `Start application` workflow runs
  `npm run dev` in development; production runs the built bundle via
  `npm run start` (`dist/index.cjs`).
- **Build:** `npm run build` bundles the client (Vite) and server (esbuild) into
  `dist/`.
- **Migrations run at boot.** `server/index.ts` calls `runMigrations()`
  (`server/migrate.ts`) *before* the HTTP server starts listening. This means:
  - A bad/failed migration prevents the new version from serving traffic — it
    fails fast at startup instead of 500ing pages later.
  - The migration runner is **idempotent and replay-safe**: it records applied
    migrations in a `_migration_log` table, ignores "already exists"-class
    errors, and does **not** record a migration as applied if any
    non-idempotent statement in it failed (so it retries next boot).
- **Post-migration drift guardrail.** After migrations run, `verifySchema()`
  compares the live database against the Drizzle models in `shared/schema.ts`
  and **throws on startup** if any model table/column is missing. See §3.

### Deploy steps (forward)

1. Merge the change to the main app.
2. Run the **pre-deploy checklist** in §6 (mandatory for schema-changing
   releases).
3. Publish/deploy via the Replit **Deployment** tool. The deploy:
   - builds the client + server,
   - boots the new version, which **runs migrations then the drift check**,
   - starts serving only if both succeed.
4. Smoke-test production (see §6, post-deploy).

---

## 2. Rollback

There are two independent things that can need rolling back: **app code** and
**database schema**. Decide which is actually broken before acting.

### 2a. Roll back the app (no schema change involved)

This is the common, safe case — a code bug, not a migration problem.

- **Preferred:** redeploy the previous known-good version (Replit keeps prior
  deployments; promote/redeploy the last green one), **or** roll the workspace
  back to the previous checkpoint and redeploy.
- Because migrations only ever **add** structure (see §4), older app code keeps
  working against the newer database. So rolling the app back by itself is safe
  and is the default first move when a fresh release misbehaves.

### 2b. Bad migration: forward-fix vs. revert

**Default to forward-fix.** Reverting schema in production is risky (it can drop
columns/tables that already hold data). Prefer to ship a *new* migration that
corrects the problem.

Choose:

- **Forward-fix (preferred, almost always):**
  - The new migration only *added* things and the app is broken for another
    reason → roll the app back (§2a) and fix forward at leisure.
  - A migration applied partially or wrong → write a new additive migration that
    brings the schema to the intended state, deploy it. The runner will apply
    only the new migration.
- **Revert the schema (last resort, data-destructive):**
  - Only when a migration introduced something actively harmful (e.g. a bad
    constraint blocking writes) that cannot wait for a forward-fix.
  - Write an explicit "down" migration as a new numbered migration that reverses
    the specific change (e.g. `DROP CONSTRAINT`, `DROP COLUMN`). **Never** hand-
    edit `_migration_log` or delete migration files in production.
  - Drop columns/tables **only** after confirming there is a backup and that no
    data needs to be preserved.

### 2c. If the app won't boot because of the drift guardrail

A startup error like
`Post-migration schema check failed: missing columns: <table>.<col>` means the
database is missing something the models declare — a migration is missing or only
partially applied. Resolve by:

1. Generating the missing migration: `npx drizzle-kit generate`.
2. Committing it and redeploying (it runs at the next boot), **or**
3. If you must restore service immediately and the change is non-critical, roll
   the app back to the version whose models match the current database (§2a).

---

## 3. Migration-safety guardrail (automated drift detection)

The post-migration check is **derived from the Drizzle models**, not a hand-
maintained list (which silently rotted whenever a model gained a field but the
list wasn't updated).

- **Source of truth:** every `pgTable` exported from `shared/schema.ts`.
- **What it checks:** that every model **table** and **column** exists in the
  database (`information_schema`). It intentionally does **not** diff types,
  nullability, defaults, or flag extra DB columns — the cheap "missing
  table/column" signal is exactly the schema-vs-migration drift this project has
  hit.
- **Where it runs:**
  - **At boot** — `verifySchema()` in `server/migrate.ts`. Drift throws and the
    app refuses to serve traffic.
  - **On demand / in CI** — `npx tsx scripts/check-schema-drift.ts` exits
    non-zero on drift. Run this as a pre-deploy gate (see §6).
- **Implementation:** `server/schemaDrift.ts`
  (`getExpectedSchema` / `detectSchemaDrift` / `computeDrift`).
- **Test:** `npx tsx server/__tests__/schemaDrift.test.ts` proves a model column
  with no migration is reported as drift.

**Consequence for developers:** if you add a column/table to `shared/schema.ts`
you MUST generate and commit the matching migration, or the app will fail to boot
(locally and in production). That is the intended safety behavior.

---

## 4. Migration authoring rules (keep them safe & reversible)

- **Generate, don't hand-write structure.** Use `npx drizzle-kit generate` after
  editing `shared/schema.ts` so the migration matches the models.
- **Prefer additive, backward-compatible changes** so old app code keeps running
  during the deploy window and an app-only rollback (§2a) stays safe:
  - Add columns as nullable or with a default.
  - Add new tables/indexes rather than repurposing existing ones.
  - To rename: add new → backfill → switch code → drop old in a *later* release,
    not all at once.
- **Make every statement replay-safe** (`IF NOT EXISTS` / `IF EXISTS`,
  `ON CONFLICT DO NOTHING`). The runner retries un-recorded migrations on the
  next boot, so statements must tolerate partial prior application.
- **Destructive changes (DROP/ALTER that loses data) are a separate, deliberate
  release** — never bundled with feature work, and only after a backup.
- **One logical change per migration file**, numbered sequentially, with a
  descriptive name.

---

## 5. Feature-flag policy for risky changes

Ship behind a flag when a change is risky to roll back, touches sensitive data,
or needs a staged rollout. The **biometrics** feature is the reference pattern:

- **Two-level, default-OFF flags.** A master switch plus per-capability
  sub-flags, both defaulting to off, so the code can ship dark and be enabled
  per-tenant when ready (e.g. biometrics `masterEnabled` + per-modality
  `faceEnabled`).
- **Flag storage:**
  - **Operational/runtime toggles** that admins or tenants flip live → a
    settings table in the database (like `biometric_settings`).
  - **Environment/infra toggles** (and required secrets) → env vars surfaced in
    `server/config.ts`. Code must fail loudly in production when a flag is on but
    its required secret is missing (e.g. biometrics requires
    `BIOMETRIC_ENCRYPTION_KEY` in prod).
- **Guidelines:**
  - The flag must gate **both** the server (routes/services return disabled/no-op
    when off) **and** the client (UI hides or no-ops gracefully).
  - Default OFF; enable progressively after verifying in production.
  - Keep the flag until the change has soaked; then remove the dead code path in
    a follow-up cleanup.

**Ship behind a flag when:** the change alters payroll/PTO/attendance
calculations, touches biometric or other sensitive data, changes the kiosk/clock
flow, or is hard to reverse. **A flag is not a substitute for a safe migration** —
schema still follows §4.

---

## 6. Release checklist for schema-changing deploys

### Pre-deploy

- [ ] `shared/schema.ts` edited → `npx drizzle-kit generate` run; the new
      migration file(s) are committed.
- [ ] Migration is **additive / backward-compatible** (or, if destructive, it is
      an isolated, deliberate release with a confirmed backup — §4).
- [ ] Every migration statement is replay-safe (`IF NOT EXISTS` / `IF EXISTS`).
- [ ] `npx tsc` passes (no type errors).
- [ ] Drift check passes locally: `npx tsx scripts/check-schema-drift.ts`.
- [ ] Relevant tests pass (at minimum
      `npx tsx server/__tests__/schemaDrift.test.ts` and
      `npx tsx server/__tests__/permissionDrift.test.ts`).
- [ ] Risky change? It is behind a default-OFF feature flag (§5).
- [ ] Rollback plan decided: app-only rollback vs. forward-fix migration (§2).

### Deploy

- [ ] Deploy via the Replit Deployment tool.
- [ ] Confirm the boot log shows
      `Post-migration schema verification passed (no drift from shared/schema.ts).`
      and **no** `Migration ... statement(s) failed` warnings.

### Post-deploy smoke test

- [ ] App is serving (health/login works).
- [ ] Pages touched by the migration load without 500s.
- [ ] If a flag was introduced, toggling it on/off behaves as expected.

### If something is wrong

- [ ] Code bug, schema fine → roll the app back (§2a).
- [ ] Migration missing/partial → generate + deploy the fix-forward migration
      (§2b / §2c).
- [ ] Actively harmful schema change → deliberate revert migration **after**
      confirming a backup (§2b, last resort).

---

## 7. Recommended next step (not built here)

Wire the pre-deploy gates into CI so they can't be skipped: run `npx tsc`,
`npx tsx scripts/check-schema-drift.ts`, and the `*drift*` tests on every PR. The
checks are already standalone and exit non-zero on failure, so this is
configuration, not new code.
