/**
 * Scheduled PostgreSQL backup.
 *
 * Runs `pg_dump` in custom (compressed) format against DATABASE_URL and uploads
 * the resulting archive to Replit Object Storage under
 *   ${PRIVATE_OBJECT_DIR}/backups/db/<timestamp>.dump
 * then prunes archives older than BACKUP_RETENTION_DAYS (default 30).
 *
 * Intended to be invoked from a Replit Scheduled Deployment (see
 * docs/backup-and-restore.md), NOT from inside the long-running app process.
 *
 * Usage:
 *   npx tsx scripts/backup-database.ts
 *
 * Environment:
 *   DATABASE_URL              (required) connection string to dump.
 *   PRIVATE_OBJECT_DIR        (required) Replit private object-storage dir.
 *   BACKUP_RETENTION_DAYS     (optional) days to keep, default 30.
 *   BACKUP_PREFIX             (optional) sub-path, default "backups/db".
 */
import { spawn } from "child_process";
import { mkdtempSync, createReadStream, statSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

function parsePrivateDir(): { bucketName: string; baseObject: string } {
  const dir = requireEnv("PRIVATE_OBJECT_DIR").replace(/\/+$/, "");
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length < 1) throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${dir}`);
  return {
    bucketName: parts[0],
    baseObject: parts.slice(1).join("/"),
  };
}

function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -Fc custom format (compressed, restorable with pg_restore), -Z6 compression.
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

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const { bucketName, baseObject } = parsePrivateDir();
  const prefix = (process.env.BACKUP_PREFIX || "backups/db").replace(/\/+$/, "");
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}.dump`;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pgbackup-"));
  const localPath = path.join(tmpDir, fileName);

  console.log(`[backup] Dumping database with pg_dump -> ${localPath}`);
  try {
    await runPgDump(databaseUrl, localPath);
    const sizeBytes = statSync(localPath).size;
    if (sizeBytes === 0) throw new Error("pg_dump produced an empty file");
    console.log(`[backup] Dump complete (${(sizeBytes / 1024 / 1024).toFixed(2)} MiB)`);

    const objectName = `${baseObject ? baseObject + "/" : ""}${prefix}/${fileName}`;
    const bucket = storage.bucket(bucketName);
    console.log(`[backup] Uploading -> ${bucketName}/${objectName}`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(localPath)
        .pipe(bucket.file(objectName).createWriteStream({ resumable: false, contentType: "application/octet-stream" }))
        .on("error", reject)
        .on("finish", resolve);
    });
    // Write/refresh a pointer to the most recent backup for easy discovery.
    await bucket
      .file(`${baseObject ? baseObject + "/" : ""}${prefix}/LATEST`)
      .save(`${fileName}\n`, { resumable: false, contentType: "text/plain" });
    console.log(`[backup] Upload complete`);

    await prune(bucketName, `${baseObject ? baseObject + "/" : ""}${prefix}/`, retentionDays);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("[backup] Done.");
}

async function prune(bucketName: string, prefix: string, retentionDays: number): Promise<void> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.log("[backup] Retention disabled (BACKUP_RETENTION_DAYS<=0), skipping prune.");
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  let deleted = 0;
  for (const file of files) {
    if (!file.name.endsWith(".dump")) continue;
    const created = file.metadata.timeCreated ? Date.parse(file.metadata.timeCreated) : NaN;
    if (Number.isFinite(created) && created < cutoff) {
      await file.delete();
      deleted++;
      console.log(`[backup] Pruned old backup: ${file.name}`);
    }
  }
  console.log(`[backup] Pruned ${deleted} backup(s) older than ${retentionDays} day(s).`);
}

main().catch((err) => {
  console.error("[backup] FAILED:", err);
  process.exit(1);
});
