import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import * as schema from "@shared/schema";

/**
 * Schema drift guardrail.
 *
 * Instead of a hand-maintained list of required tables/columns (which silently
 * rots every time a model gains a field but the list isn't updated), this
 * derives the expected database shape directly from the Drizzle models in
 * `shared/schema.ts`. At boot (see `server/migrate.ts`) we compare that expected
 * shape against `information_schema` and fail loudly if the database is missing
 * any table or column the models declare — i.e. a migration is missing or only
 * partially applied. The same check is exposed as a standalone CLI via
 * `scripts/check-schema-drift.ts` for use in the release checklist / CI.
 *
 * Scope: presence of tables and columns only. We intentionally do NOT diff
 * types, nullability, defaults, or flag extra DB columns — extra columns are
 * frequently legacy/intentional, and the cheap "missing table/column" signal is
 * what catches the schema-vs-migration drift this project has actually hit.
 */

export interface SchemaDriftResult {
  /** Tables declared in the models but absent from the database. */
  missingTables: string[];
  /** `table.column` pairs declared in the models but absent from the database. */
  missingColumns: string[];
}

/**
 * Tables that exist at runtime but are not part of the Drizzle models, so they
 * must not be treated as drift. `_migration_log` is created by the migration
 * runner itself.
 */
const RUNTIME_ONLY_TABLES = new Set<string>(["_migration_log"]);

/**
 * Build the expected database shape (table name -> set of column names) from
 * every `pgTable` exported by `shared/schema.ts`. Aliased exports that point at
 * the same underlying table (e.g. `divisions` -> `companies`,
 * `attendanceRecords` -> `punch_logs`) collapse harmlessly by table name.
 */
export function getExpectedSchema(): Map<string, Set<string>> {
  const expected = new Map<string, Set<string>>();
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    if (RUNTIME_ONLY_TABLES.has(cfg.name)) continue;
    let columns = expected.get(cfg.name);
    if (!columns) {
      columns = new Set<string>();
      expected.set(cfg.name, columns);
    }
    for (const column of cfg.columns) {
      columns.add(column.name);
    }
  }
  return expected;
}

/**
 * Pure drift computation — testable without a database. Compares the expected
 * model shape against the observed database tables/columns.
 */
export function computeDrift(
  expected: Map<string, Set<string>>,
  existingTables: Set<string>,
  existingColumns: Map<string, Set<string>>,
): SchemaDriftResult {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const [table, columns] of expected) {
    if (!existingTables.has(table)) {
      missingTables.push(table);
      continue;
    }
    const present = existingColumns.get(table) ?? new Set<string>();
    for (const column of columns) {
      if (!present.has(column)) {
        missingColumns.push(`${table}.${column}`);
      }
    }
  }

  missingTables.sort();
  missingColumns.sort();
  return { missingTables, missingColumns };
}

/** Run the drift check against a live connection. */
export async function detectSchemaDrift(client: PoolClient): Promise<SchemaDriftResult> {
  const expected = getExpectedSchema();

  const { rows: tableRows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const existingTables = new Set(tableRows.map((r) => r.table_name));

  const { rows: columnRows } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const existingColumns = new Map<string, Set<string>>();
  for (const row of columnRows) {
    let cols = existingColumns.get(row.table_name);
    if (!cols) {
      cols = new Set<string>();
      existingColumns.set(row.table_name, cols);
    }
    cols.add(row.column_name);
  }

  return computeDrift(expected, existingTables, existingColumns);
}

export function hasSchemaDrift(result: SchemaDriftResult): boolean {
  return result.missingTables.length > 0 || result.missingColumns.length > 0;
}

export function formatSchemaDrift(result: SchemaDriftResult): string {
  const parts: string[] = [];
  if (result.missingTables.length > 0) {
    parts.push(`missing tables: ${result.missingTables.join(", ")}`);
  }
  if (result.missingColumns.length > 0) {
    parts.push(`missing columns: ${result.missingColumns.join(", ")}`);
  }
  return parts.join("; ");
}
