/**
 * Restore-verification check for the latest PostgreSQL backup.
 *
 * Always-on checks (no extra infrastructure):
 *   1. Locate the newest archive under ${PRIVATE_OBJECT_DIR}/backups/db/.
 *   2. Download it and validate archive integrity with `pg_restore --list`
 *      (a corrupt/truncated dump fails here).
 *   3. Assert the table-of-contents contains the core tables we expect.
 *
 * Optional full restore (recommended for periodic DR drills):
 *   If BACKUP_VERIFY_DATABASE_URL is set, the archive is restored into that
 *   SCRATCH database and a few sanity counts are run. NEVER point this at the
 *   production DATABASE_URL — the script refuses if they are equal.
 *
 * Usage:
 *   npx tsx scripts/verify-backup.ts
 *
 * Exit code 0 = verified, non-zero = problem found.
 */
import { spawnSync } from "child_process";
import { mkdtempSync, createWriteStream, statSync, rmSync } from "fs";
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

// Core tables that must always be present in a healthy dump.
const EXPECTED_TABLES = ["users", "companies", "punch_logs", "time_off_requests", "audit_logs"];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

function parsePrivateDir(): { bucketName: string; baseObject: string } {
  const dir = requireEnv("PRIVATE_OBJECT_DIR").replace(/\/+$/, "");
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length < 1) throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${dir}`);
  return { bucketName: parts[0], baseObject: parts.slice(1).join("/") };
}

async function main(): Promise<void> {
  const { bucketName, baseObject } = parsePrivateDir();
  const prefix = `${baseObject ? baseObject + "/" : ""}${(process.env.BACKUP_PREFIX || "backups/db").replace(/\/+$/, "")}/`;

  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  const dumps = files
    .filter((f) => f.name.endsWith(".dump"))
    .sort((a, b) => {
      const ta = a.metadata.timeCreated ? Date.parse(a.metadata.timeCreated) : 0;
      const tb = b.metadata.timeCreated ? Date.parse(b.metadata.timeCreated) : 0;
      return tb - ta;
    });

  if (dumps.length === 0) {
    throw new Error(`No .dump backups found under ${bucketName}/${prefix}. Run scripts/backup-database.ts first.`);
  }

  const latest = dumps[0];
  console.log(`[verify] Latest backup: ${latest.name} (created ${latest.metadata.timeCreated})`);

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pgverify-"));
  const localPath = path.join(tmpDir, "latest.dump");

  try {
    console.log("[verify] Downloading archive...");
    await new Promise<void>((resolve, reject) => {
      latest
        .createReadStream()
        .pipe(createWriteStream(localPath))
        .on("error", reject)
        .on("finish", resolve);
    });
    const sizeBytes = statSync(localPath).size;
    if (sizeBytes === 0) throw new Error("Downloaded archive is empty");
    console.log(`[verify] Downloaded ${(sizeBytes / 1024 / 1024).toFixed(2)} MiB`);

    // 1) Integrity + table-of-contents check.
    const list = spawnSync("pg_restore", ["--list", localPath], { encoding: "utf-8" });
    if (list.status !== 0) {
      throw new Error(`pg_restore --list failed (archive likely corrupt):\n${list.stderr}`);
    }
    const toc = list.stdout;
    const missing = EXPECTED_TABLES.filter((t) => !new RegExp(`TABLE (DATA )?public ${t}\\b`).test(toc));
    if (missing.length > 0) {
      throw new Error(`Backup is readable but missing expected tables in TOC: ${missing.join(", ")}`);
    }
    console.log(`[verify] Archive integrity OK; found all ${EXPECTED_TABLES.length} core tables in TOC.`);

    // 2) Optional full restore into a scratch DB.
    const scratchUrl = process.env.BACKUP_VERIFY_DATABASE_URL;
    if (scratchUrl) {
      if (scratchUrl === process.env.DATABASE_URL) {
        throw new Error("BACKUP_VERIFY_DATABASE_URL must NOT equal DATABASE_URL — refusing to restore over production.");
      }
      console.log("[verify] Restoring into scratch database...");
      const restore = spawnSync(
        "pg_restore",
        ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", scratchUrl, localPath],
        { encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"] },
      );
      // pg_restore may exit non-zero on benign warnings; treat as warning, then verify with counts.
      if (restore.status !== 0) {
        console.warn(`[verify] pg_restore returned ${restore.status} (often benign warnings) — verifying via row counts.`);
      }
      const counts = spawnSync(
        "psql",
        [
          scratchUrl,
          "-Atc",
          "SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'companies=' || count(*) FROM companies;",
        ],
        { encoding: "utf-8" },
      );
      if (counts.status !== 0) {
        throw new Error(`Scratch DB sanity query failed after restore:\n${counts.stderr}`);
      }
      console.log(`[verify] Scratch restore sanity counts:\n${counts.stdout.trim()}`);
    } else {
      console.log("[verify] BACKUP_VERIFY_DATABASE_URL not set — skipping full scratch restore (integrity check only).");
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("[verify] PASSED.");
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
