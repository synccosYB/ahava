import { pool } from "./db";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";

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

interface ColumnRow {
  column_name: string;
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  employee_pto_settings: [
    "vacation_balance_override",
    "sick_balance_override",
    "personal_balance_override",
    "hire_date",
    "notes",
  ],
};

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
      await verifyRequiredColumns(client);
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

    await verifyRequiredColumns(client);
  } finally {
    client.release();
  }
}

async function verifyRequiredColumns(client: PoolClient): Promise<void> {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await client.query<ColumnRow>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    const existing = new Set(rows.map((r) => r.column_name));
    const missing = columns.filter((c) => !existing.has(c));
    if (missing.length > 0) {
      throw new Error(
        `Post-migration check failed: ${table} is missing columns: ${missing.join(", ")}. ` +
        `The /api/attendance/status endpoint will fail. Check migration logs above.`
      );
    }
  }
  console.log("Post-migration column verification passed.");
}
