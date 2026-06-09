/**
 * Standalone schema-drift checker for the release checklist / CI.
 *
 * Compares the live database (via DATABASE_URL) against the Drizzle models in
 * `shared/schema.ts` and exits non-zero if any model table/column is missing
 * from the database — i.e. a migration is missing or only partially applied.
 *
 * Run with: `npx tsx scripts/check-schema-drift.ts`
 *
 * This is the same check `server/migrate.ts` runs at boot, exposed as a script
 * so it can gate a deploy before the app is restarted in production.
 */
import { pool } from "../server/db";
import {
  detectSchemaDrift,
  hasSchemaDrift,
  formatSchemaDrift,
} from "../server/schemaDrift";

async function main() {
  const client = await pool.connect();
  try {
    const drift = await detectSchemaDrift(client);
    if (hasSchemaDrift(drift)) {
      console.error(`Schema drift detected: ${formatSchemaDrift(drift)}`);
      console.error(
        "A migration is missing or only partially applied. " +
          "Run `npx drizzle-kit generate` to create the missing migration.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("No schema drift — database matches shared/schema.ts.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
