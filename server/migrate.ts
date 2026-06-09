import { pool } from "./db";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { detectSchemaDrift, hasSchemaDrift, formatSchemaDrift } from "./schemaDrift";

const IDEMPOTENT_ERROR_CODES = new Set([
  "42701",
  "42P07",
  "23505",
  "42710",
]);

interface PgError extends Error {
  code?: string;
}

function isIdempotentError(err: PgError): boolean {
  return (
    (err.code !== undefined && IDEMPOTENT_ERROR_CODES.has(err.code)) ||
    err.message?.includes("already exists")
  );
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_migration_log" (
        "tag" varchar PRIMARY KEY,
        "applied_at" timestamp DEFAULT now()
      )
    `);

    const journalPath = path.resolve("migrations/meta/_journal.json");
    if (!fs.existsSync(journalPath)) {
      console.log("No migration journal found, skipping migrations.");
      await verifySchema(client);
      return;
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entries: { tag: string }[] = journal.entries || [];

    for (const entry of entries) {
      const { rows } = await client.query(
        `SELECT tag FROM "_migration_log" WHERE tag = $1`,
        [entry.tag]
      );
      if (rows.length > 0) continue;

      const sqlFile = path.resolve(`migrations/${entry.tag}.sql`);
      if (!fs.existsSync(sqlFile)) {
        console.warn(`Migration file not found: ${sqlFile}, skipping.`);
        continue;
      }

      const sql = fs.readFileSync(sqlFile, "utf-8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      console.log(`Applying migration: ${entry.tag} (${statements.length} statements)`);
      const failedStatements: string[] = [];
      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (err: unknown) {
          const pgErr = err as PgError;
          if (isIdempotentError(pgErr)) {
            continue;
          }
          failedStatements.push(pgErr.message);
          console.warn(`Migration statement warning (${entry.tag}):`, pgErr.message);
        }
      }

      if (failedStatements.length > 0) {
        console.error(
          `Migration ${entry.tag}: ${failedStatements.length} non-idempotent statement(s) failed. ` +
          `NOT recording as applied so it will be retried on next startup.`
        );
        continue;
      }

      await client.query(
        `INSERT INTO "_migration_log" (tag) VALUES ($1) ON CONFLICT DO NOTHING`,
        [entry.tag]
      );
      console.log(`Migration applied: ${entry.tag}`);
    }

    await verifySchema(client);
  } finally {
    client.release();
  }
}

/**
 * Post-migration drift guardrail. The expected tables/columns are derived
 * directly from the Drizzle models in `shared/schema.ts` (see
 * `server/schemaDrift.ts`) rather than a hand-maintained list, so adding a
 * column to a model without shipping the matching migration fails the boot
 * loudly instead of 500ing a page at runtime.
 */
async function verifySchema(client: PoolClient): Promise<void> {
  const drift = await detectSchemaDrift(client);

  if (hasSchemaDrift(drift)) {
    throw new Error(
      `Post-migration schema check failed: ${formatSchemaDrift(drift)}. ` +
      `The database is missing tables/columns declared in shared/schema.ts — ` +
      `a migration is likely missing or only partially applied, and the ` +
      `affected pages will return 500 errors. Generate the missing migration ` +
      `(npx drizzle-kit generate) and check the migration logs above.`
    );
  }

  console.log("Post-migration schema verification passed (no drift from shared/schema.ts).");
}
