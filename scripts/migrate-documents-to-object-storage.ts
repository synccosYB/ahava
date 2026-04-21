import fs from "fs";
import path from "path";
import { db } from "../server/db";
import { documents } from "../shared/schema";
import { eq } from "drizzle-orm";
import {
  uploadDocumentBuffer,
  isObjectStoragePath,
} from "../server/services/documentStorage";

async function main() {
  const all = await db.select().from(documents);
  console.log(`Found ${all.length} document records`);

  let migrated = 0;
  let skippedAlready = 0;
  let skippedMissing = 0;
  let failed = 0;

  for (const doc of all) {
    if (isObjectStoragePath(doc.filePath)) {
      skippedAlready++;
      continue;
    }

    if (!fs.existsSync(doc.filePath)) {
      console.warn(`Local file missing for doc ${doc.id}: ${doc.filePath}`);
      skippedMissing++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(doc.filePath);
      const uploaded = await uploadDocumentBuffer(
        buffer,
        doc.fileName || path.basename(doc.filePath),
        doc.mimeType || "application/octet-stream",
      );
      await db
        .update(documents)
        .set({ filePath: uploaded.storagePath })
        .where(eq(documents.id, doc.id));
      console.log(`Migrated ${doc.id} -> ${uploaded.storagePath}`);
      migrated++;
    } catch (err) {
      console.error(`Failed to migrate ${doc.id}:`, err);
      failed++;
    }
  }

  console.log(
    `Done. migrated=${migrated} alreadyInStorage=${skippedAlready} missingLocal=${skippedMissing} failed=${failed}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
