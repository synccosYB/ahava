# Backup & Restore / Disaster Recovery Strategy

> **Audience:** whoever is on the hook when data is lost or corrupted. This is an
> operational runbook — keep it followable under pressure.
>
> **Scope:** the production PostgreSQL database and the employee documents stored in
> Replit Object Storage. Source code and migrations are version-controlled in the
> repo (and on Replit checkpoints) and are out of scope here.

---

## 1. Current platform state (what we already get for free)

This app runs on Replit. Before adding our own tooling, understand what the platform
already provides:

| Asset | Where it lives | Built-in protection |
| --- | --- | --- |
| **PostgreSQL** | Replit-managed Postgres 16 (`DATABASE_URL`, internal `helium` host). | Replit **Checkpoints** snapshot the database alongside code/chat during development, and you can **roll back** to a checkpoint from the workspace. This is the primary safety net during active development. |
| **Employee documents** (W-9, I-9, pay stubs, etc.) | Replit Object Storage (GCS-backed sidecar), under `${PRIVATE_OBJECT_DIR}/documents/`. | Replit Object Storage is backed by Google Cloud Storage, which is highly durable. There is **no point-in-time rollback** for object storage — a deleted/overwritten object is gone unless we keep our own copies. |
| **Source & migrations** | Git + Replit checkpoints. | Full history; redeployable at any time. |

**Gaps this strategy closes:**
1. Checkpoints are great in development but are **not a substitute for off-platform,
   independently-restorable database backups** with a defined retention window.
2. There is no automated, verifiable database dump and no documented restore
   procedure.
3. There is no defined RPO/RTO, and no documented approach for partial restores
   (single tenant / single employee).

---

## 2. RPO / RTO targets

For a payroll/HR system, the data is sensitive but not high-frequency (punches,
PTO, documents). We set deliberately conservative, achievable targets:

| Metric | Target | Rationale |
| --- | --- | --- |
| **RPO** (max acceptable data loss) | **24 hours** | A nightly dump bounds worst-case loss to one day. Checkpoints during active development typically make real-world loss much smaller. Tighten to 1h with WAL/PITR if/when payroll volume grows (see §8). |
| **RTO** (max time to restore service) | **≤ 2 hours** | A full `pg_restore` of a dump of this size completes in minutes; the 2h budget covers provisioning a fresh DB, restoring, re-pointing `DATABASE_URL`, and redeploying. |

These are the commitments the rest of this document is built to meet.

---

## 3. Backup cadence, storage, and retention

| Dimension | Decision |
| --- | --- |
| **What** | Full logical dump of the entire Postgres database in `pg_dump` custom format (compressed, restorable with `pg_restore`). Employee documents are already in durable object storage; see §6 for their protection. |
| **Cadence** | **Nightly** via a Replit **Scheduled Deployment** running `scripts/backup-database.ts` (see §7). Run on-demand before any risky migration or bulk operation. |
| **Where** | Uploaded to Replit Object Storage under `${PRIVATE_OBJECT_DIR}/backups/db/<ISO-timestamp>.dump`. A `LATEST` pointer file records the newest archive name. Storing in object storage keeps backups independent of the database itself. |
| **Retention** | **30 days** rolling, controlled by `BACKUP_RETENTION_DAYS` (default 30). The backup script prunes `.dump` files older than the window on each run. |
| **Encryption / access** | Backups live in the **private** object-storage prefix (not publicly served). They contain a copy of the production database — treat them as the most sensitive asset in the system. |

> **Off-platform copy (recommended):** for true disaster recovery (i.e. surviving
> loss of the Replit account itself), periodically download a dump and store it with
> a second provider. Captured as a follow-up in §8.

---

## 4. The tooling

Two scripts back this strategy. Both are dependency-light (they reuse the bundled
`pg_dump`/`pg_restore`/`psql` 16 binaries and the existing object-storage client) and
are runnable directly with `tsx` — no `package.json` changes required.

### `scripts/backup-database.ts`
- Runs `pg_dump --format=custom` against `DATABASE_URL`.
- Uploads the archive to `…/backups/db/<timestamp>.dump` and refreshes `LATEST`.
- Prunes archives older than `BACKUP_RETENTION_DAYS`.
- Run: `npx tsx scripts/backup-database.ts`

### `scripts/verify-backup.ts`
- Finds the newest `.dump`, downloads it, and validates archive integrity with
  `pg_restore --list` (catches truncated/corrupt dumps).
- Asserts the table-of-contents contains the core tables (`users`, `companies`,
  `punch_logs`, `time_off_requests`, `audit_logs`).
- **Optional full drill:** if `BACKUP_VERIFY_DATABASE_URL` is set (and is NOT the
  production URL), it restores the dump into that scratch DB and runs sanity counts.
- Run: `npx tsx scripts/verify-backup.ts`

> A backup you have never restored is not a backup. Run the full drill (§5.4) on a
> schedule, not just the integrity check.

### Environment variables
| Var | Used by | Required | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | both | yes | — |
| `PRIVATE_OBJECT_DIR` | both | yes | — |
| `BACKUP_RETENTION_DAYS` | backup | no | `30` |
| `BACKUP_PREFIX` | both | no | `backups/db` |
| `BACKUP_VERIFY_DATABASE_URL` | verify | no (enables full restore drill) | — |

---

## 5. Restore runbook

> **Before you start:** stop or pause writes if possible (put the app in maintenance
> or scale the deployment to zero) so you are not restoring under a moving target.

### 5.1 Identify the backup to restore
```bash
# List available dumps (newest last):
npx tsx -e "import('@google-cloud/storage')" >/dev/null 2>&1   # sanity: deps present
# Or inspect via the verify script, which always reports the latest archive:
npx tsx scripts/verify-backup.ts
```
The `LATEST` file in `…/backups/db/` names the most recent archive. Pick an earlier
timestamp instead if you are recovering from corruption that the latest dump already
captured.

### 5.2 Provision a target database
- **New/fresh DB (preferred for full DR):** provision a new Replit Postgres database
  and note its connection string.
- **Scratch DB on the same server (for drills/partial restores):**
  ```bash
  psql "$DATABASE_URL" -c "CREATE DATABASE scratch_restore;"
  # scratch URL: same as DATABASE_URL but with /scratch_restore as the database name
  ```

### 5.3 Restore
Download the chosen archive (the verify script downloads `latest.dump` to a temp dir;
for an arbitrary archive, copy it out of object storage), then:
```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "<TARGET_DATABASE_URL>" path/to/<timestamp>.dump
```
`pg_restore` may print benign warnings (e.g. dropping objects that don't exist on a
fresh DB) and exit non-zero — verify success by data, not just exit code.

### 5.4 Verify the restore
```bash
psql "<TARGET_DATABASE_URL>" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
psql "<TARGET_DATABASE_URL>" -Atc "SELECT 'users=' || count(*) FROM users;"
```
- Table count should match production (currently **67**).
- Boot the app against the target by setting its `DATABASE_URL` and starting the
  workflow; the startup migration/verification (`server/migrate.ts`) must pass and
  key admin pages (Employees, Time, Reports) must load.

### 5.5 Cut over
- Point the production `DATABASE_URL` at the restored database (or promote it).
- Redeploy / restart the app.
- Confirm clock-in/out, PTO, and reports work, then re-enable writes.

### 5.6 Clean up
```bash
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS scratch_restore;"
```

---

## 6. Employee documents (object storage)

Documents are written under `${PRIVATE_OBJECT_DIR}/documents/` and the database row
in `documents.filePath` / `payroll_documents` points at the object path. Because the
DB and the files are separate systems:

- A **database restore alone** brings back the *metadata and pointers*; the actual
  files must still exist in object storage. Object storage is durable (GCS-backed)
  and is not rolled back by checkpoints, so a DB rollback does **not** delete files.
- **Risk:** an old DB backup can reference a file that was later deleted, or a newer
  file can be orphaned after a DB rollback. Treat the DB and object storage as
  loosely coupled and reconcile after any restore.
- **To protect the files themselves** against accidental deletion, periodically
  mirror `…/documents/` to a second location (another bucket or off-platform). This
  is captured as a follow-up in §8 rather than built here, since object storage is
  already highly durable and the immediate gap is the database.

---

## 7. Scheduling the nightly backup

Use a **Replit Scheduled Deployment** (separate from the always-on app) so backups
run independently of app uptime — an autoscale app can scale to zero, so the backup
must not depend on the app process:

1. Create a **Scheduled Deployment**.
2. Command: `npx tsx scripts/backup-database.ts`
3. Schedule: nightly (e.g. `0 7 * * *` UTC — pick a low-traffic hour).
4. Ensure the deployment has `DATABASE_URL` and `PRIVATE_OBJECT_DIR` available
   (they are part of the standard Replit environment).
5. Add a second scheduled job (e.g. weekly) running `npx tsx scripts/verify-backup.ts`
   so verification is continuous, not a manual afterthought. For a periodic *full*
   DR drill, set `BACKUP_VERIFY_DATABASE_URL` to a scratch database on that job.

---

## 8. Limitations & recommended follow-ups

These are intentionally **out of scope** for this task (documentation + low-effort
tooling) and should be tracked separately:

- **Point-in-time recovery (PITR / WAL archiving)** to push RPO toward minutes. The
  current nightly-dump approach has a 24h worst-case RPO. PITR requires WAL shipping
  infrastructure — a larger effort.
- **Tenant-level point-in-time restore tooling.** Today, single-tenant recovery is a
  manual extract-and-merge (see §9), which is fine for incidents but not a one-click
  feature. Building first-class per-tenant restore is a larger project.
- **Off-platform / cross-provider backup copies** for surviving loss of the Replit
  account, plus **document (object-storage) mirroring** (§6).
- **Backup encryption-at-rest with a managed key** if compliance requires more than
  the private-bucket access boundary.
- **Alerting** when a scheduled backup or verification fails (wire the script exit
  codes into the existing alerts surface).

---

## 9. Partial restores

A full dump can answer both partial-restore questions; the trade-off is that the work
is manual (extract from a side-restored copy, then merge), not automated.

### 9.1 Can a single tenant be restored?
**Yes — via extract-and-merge.** Tenants are `companies`, and most domain tables carry
a `companyId` (directly or transitively through `locations`/`departments`/`users`).

1. Restore the dump into a **scratch database** (§5.2–5.3) — never restore a whole
   dump over live production to recover one tenant.
2. From the scratch DB, export only that tenant's rows, ordered to respect foreign
   keys (companies → locations/departments → users → employment profiles → punches,
   PTO, documents, audit logs, …). Example:
   ```bash
   psql "<SCRATCH_URL>" -Atc "\copy (SELECT * FROM punch_logs p \
     JOIN users u ON u.id = p.user_id WHERE u.company_id = '<COMPANY_ID>') TO 'punch_logs.csv' CSV HEADER"
   ```
3. Load the extracted rows back into production with `\copy … FROM`, resolving
   conflicts (upsert on primary key) and inserting parents before children.

> Because tenant data is interleaved across ~49 tables, scope each incident: usually
> only a handful of tables (punches, PTO, documents) actually need recovery. Identify
> the affected tables first rather than blindly copying everything.

### 9.2 Can a single employee's data be restored?
**Yes — same pattern, narrower filter.** An employee is a `users` row plus child rows
keyed by `userId` (`user_employment_profiles`, `punch_logs`, `attendance_exceptions`,
`time_off_requests`, `time_off_balances`, `documents`, `payroll_documents`,
`audit_logs`, biometric tables, …).

1. Restore the dump into a scratch DB (§5.2–5.3).
2. Extract that user's rows table-by-table filtered on `user_id = '<USER_ID>'` (and
   the `users` row itself).
3. Merge back into production, parents first, upserting on primary key.

For biometric data specifically, respect consent/legal-hold state in
`server/services/biometricRetention.ts` — do not re-introduce templates for a user
whose consent was revoked.

---

## 10. Quick reference

```bash
# Take a backup now
npx tsx scripts/backup-database.ts

# Verify the latest backup (integrity only)
npx tsx scripts/verify-backup.ts

# Full DR drill: restore latest into a scratch DB and sanity-check
psql "$DATABASE_URL" -c "CREATE DATABASE scratch_restore;"
BACKUP_VERIFY_DATABASE_URL="<scratch url>" npx tsx scripts/verify-backup.ts
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS scratch_restore;"

# Manual full restore into a target DB
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "<TARGET_DATABASE_URL>" path/to/<timestamp>.dump
```
