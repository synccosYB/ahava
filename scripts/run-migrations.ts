/**
 * Standalone entrypoint for the SQL migrations in migrations/ (the same
 * runMigrations() the server runs on boot). Used by CI and available for local
 * setup: `npm run db:migrate` (requires DATABASE_URL).
 */
import { runMigrations } from "../server/migrate";
import { pool } from "../server/db";

runMigrations()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
