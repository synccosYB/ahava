/**
 * One-off production data wipe (standalone entry point).
 *
 * Truncates ALL application tables in the database pointed to by DATABASE_URL
 * (preserving schema + the `_migration_log` migration bookkeeping table),
 * after taking and verifying a final pg_dump backup uploaded to object
 * storage. See server/prodDataWipe.ts for the full safety design — this
 * script is a thin CLI wrapper around the same one-shot, marker-guarded
 * implementation, and is safe to re-run (the marker makes it a no-op).
 *
 * Usage (must pass the explicit confirmation flag):
 *   npx tsx scripts/wipe-database.ts --yes-really-wipe-prod
 *
 * NOTE: run this WHERE DATABASE_URL points at the database you intend to
 * wipe. In the Replit workspace, DATABASE_URL is the DEVELOPMENT database;
 * the production wipe runs via the boot hook in server/index.ts, gated by
 * the production-only WIPE_PROD_DATA env flag.
 */
import { maybeWipeProductionData, WIPE_MARKER_TAG } from "../server/prodDataWipe";
import { pool } from "../server/db";

async function main(): Promise<void> {
  if (!process.argv.includes("--yes-really-wipe-prod")) {
    console.error(
      "Refusing to run without explicit confirmation.\n" +
        "This PERMANENTLY deletes all rows in every application table of the\n" +
        "database at DATABASE_URL (schema and migration log are preserved; a\n" +
        "verified backup is taken first).\n\n" +
        "To proceed: npx tsx scripts/wipe-database.ts --yes-really-wipe-prod",
    );
    process.exit(2);
  }
  process.env.WIPE_PROD_DATA = "yes-really-wipe-prod";
  await maybeWipeProductionData();
  console.log(`[wipe-database] Complete. One-shot marker: ${WIPE_MARKER_TAG}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[wipe-database] FAILED (no data was deleted unless explicitly logged above):", err);
  process.exit(1);
});
