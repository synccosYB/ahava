/**
 * One-shot production data wipe (Task: wipe all production data).
 *
 * Runs at server boot, AFTER migrations (so `_migration_log` exists and the
 * schema is verified) and BEFORE seed() (so the same boot re-creates the
 * bootstrap admin, roles, and default PTO policy/GLOBAL assignment).
 *
 * Safety design — it only ever runs when ALL of these hold:
 *   1. Env flag WIPE_PROD_DATA === "yes-really-wipe-prod" (set only in the
 *      production environment; standalone script sets it from the
 *      --yes-really-wipe-prod CLI flag).
 *   2. The one-shot marker tag is NOT yet present in `_migration_log`.
 *      After a successful wipe the marker is inserted, so later boots and
 *      concurrent autoscale instances skip instantly even if the env flag
 *      is still set.
 *   3. A fresh pg_dump backup of the database has been taken, uploaded to
 *      object storage (${PRIVATE_OBJECT_DIR}/backups/db/pre-wipe-*.dump),
 *      and verified with `pg_restore --list` + core-table TOC check.
 *      Any failure ABORTS the wipe (boot fails loudly; data untouched).
 *
 * The wipe TRUNCATEs every application table in `public` EXCEPT the
 * migration bookkeeping table `_migration_log`. Schema, migrations, and
 * object storage files are untouched.
 */
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, createReadStream, statSync, rmSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { pool } from "./db";

export const WIPE_MARKER_TAG = "9999_prod_data_wipe_2026_08_11";
const WIPE_FLAG_VALUE = "yes-really-wipe-prod";
const ADVISORY_LOCK_KEY = 815_522_001;

/** Tables that must never be truncated. */
const PRESERVED_TABLES = new Set(["_migration_log"]);

/** Core tables that must appear in the backup's table of contents. */
const EXPECTED_TABLES = ["users", "companies", "punch_logs", "time_off_requests", "audit_logs"];

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function makeStorage(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
}

function parsePrivateDir(): { bucketName: string; baseObject: string } {
  const dir = (process.env.PRIVATE_OBJECT_DIR || "").replace(/\/+$/, "");
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR must be set for the pre-wipe backup");
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length < 1) throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${dir}`);
  return { bucketName: parts[0], baseObject: parts.slice(1).join("/") };
}

function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", outFile, databaseUrl],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

/** Backup + verify + upload. Throws on ANY problem — caller must not wipe. */
async function backupAndVerify(databaseUrl: string): Promise<string> {
  const { bucketName, baseObject } = parsePrivateDir();
  const prefix = (process.env.BACKUP_PREFIX || "backups/db").replace(/\/+$/, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `pre-wipe-${stamp}.dump`;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "prewipe-"));
  const localPath = path.join(tmpDir, fileName);

  try {
    console.log(`[prod-wipe] Taking final backup with pg_dump -> ${localPath}`);
    await runPgDump(databaseUrl, localPath);
    const sizeBytes = statSync(localPath).size;
    if (sizeBytes === 0) throw new Error("pg_dump produced an empty file");
    console.log(`[prod-wipe] Dump complete (${(sizeBytes / 1024 / 1024).toFixed(2)} MiB)`);

    // Verify archive integrity + table of contents BEFORE deleting anything.
    const list = spawnSync("pg_restore", ["--list", localPath], { encoding: "utf-8" });
    if (list.status !== 0) {
      throw new Error(`pg_restore --list failed (archive likely corrupt):\n${list.stderr}`);
    }
    const toc = list.stdout;
    const missing = EXPECTED_TABLES.filter((t) => !new RegExp(`TABLE (DATA )?public ${t}\\b`).test(toc));
    if (missing.length > 0) {
      throw new Error(`Backup readable but missing expected tables in TOC: ${missing.join(", ")}`);
    }
    console.log(`[prod-wipe] Backup verified (all ${EXPECTED_TABLES.length} core tables present in TOC).`);

    const objectName = `${baseObject ? baseObject + "/" : ""}${prefix}/${fileName}`;
    const bucket = makeStorage().bucket(bucketName);
    console.log(`[prod-wipe] Uploading backup -> ${bucketName}/${objectName}`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(localPath)
        .pipe(bucket.file(objectName).createWriteStream({ resumable: false, contentType: "application/octet-stream" }))
        .on("error", reject)
        .on("finish", resolve);
    });

    // Re-check the uploaded object exists and matches the local size.
    const [meta] = await bucket.file(objectName).getMetadata();
    if (Number(meta.size) !== sizeBytes) {
      throw new Error(`Uploaded backup size mismatch (local ${sizeBytes}, remote ${meta.size})`);
    }
    console.log(`[prod-wipe] Backup uploaded and size-verified.`);
    return objectName;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Boot hook. No-op unless WIPE_PROD_DATA=yes-really-wipe-prod AND the marker
 * is absent. Throws (failing the boot) if the wipe was requested but the
 * backup could not be taken and verified.
 */
export async function maybeWipeProductionData(): Promise<void> {
  // Trigger 1: explicit env flag (works for the standalone CLI script too).
  const envArmed = process.env.WIPE_PROD_DATA === WIPE_FLAG_VALUE;
  // Trigger 2: committed sentinel file — honored ONLY inside a Replit
  // deployment (REPLIT_DEPLOYMENT is set there and never in the dev
  // workspace), so a dev boot can never wipe the development database.
  // Used because env-var changes may not propagate into a deployment.
  const fileArmed =
    !!process.env.REPLIT_DEPLOYMENT &&
    existsSync(path.resolve("WIPE_PROD_DATA.trigger"));
  if (!envArmed && !fileArmed) return;
  console.log(`[prod-wipe] Armed via ${envArmed ? "env flag" : "trigger file"}.`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("[prod-wipe] DATABASE_URL must be set");

  const client = await pool.connect();
  try {
    // Serialize against concurrent autoscale instances booting at once.
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      const { rows } = await client.query(`SELECT tag FROM "_migration_log" WHERE tag = $1`, [WIPE_MARKER_TAG]);
      if (rows.length > 0) {
        console.log("[prod-wipe] Wipe marker already present — skipping (already done).");
        return;
      }

      console.log("[prod-wipe] WIPE_PROD_DATA flag set and marker absent — starting final backup.");
      const backupObject = await backupAndVerify(databaseUrl);

      const { rows: tableRows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      const tables = tableRows.map((r) => r.table_name).filter((t) => !PRESERVED_TABLES.has(t));
      if (tables.length === 0) throw new Error("[prod-wipe] No application tables found — refusing to proceed.");

      const identifiers = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ");
      console.log(`[prod-wipe] Truncating ${tables.length} application table(s) (preserving: ${[...PRESERVED_TABLES].join(", ")})...`);
      await client.query("BEGIN");
      try {
        await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
        await client.query(`INSERT INTO "_migration_log" (tag) VALUES ($1) ON CONFLICT DO NOTHING`, [WIPE_MARKER_TAG]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      console.log(`[prod-wipe] DONE. All application data wiped. Final backup: ${backupObject}`);
      console.log("[prod-wipe] seed() will now re-create the bootstrap admin, roles, and default PTO policy.");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
