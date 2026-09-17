/**
 * Standalone migration runner.
 *
 * Applies every pending migration in `migrations/meta/_journal.json` using the
 * same journal-driven runner the server uses at boot (`server/migrate.ts`), then
 * exits. Used by `npm run db:migrate` and by the test setup so a freshly-created
 * database can be migrated without booting the whole app.
 *
 * Requires DATABASE_URL.
 */
import { runMigrations } from "../server/migrate";
import { pool } from "../server/db";

runMigrations()
  .then(() => pool.end())
  .then(() => {
    console.log("Migrations complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
