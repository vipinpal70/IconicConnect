import 'dotenv/config';
import { db } from '../../db';
import { caseFiles } from '../../db/schema/case';
import { eq, or } from 'drizzle-orm';
import { existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';

export async function runCleanup() {
  console.log('[Cleanup] Starting case_data background cleanup...');
  const baseDir = join(process.cwd(), 'case_data');

  if (!existsSync(baseDir)) {
    console.log('[Cleanup] case_data directory does not exist. Skipping.');
    return;
  }

  try {
    const clients = readdirSync(baseDir);
    const gracePeriodMs = 60 * 60 * 1000; // 1 Hour grace period
    const now = Date.now();

    for (const clientName of clients) {
      const clientDir = join(baseDir, clientName);
      if (!statSync(clientDir).isDirectory()) continue;

      const files = readdirSync(clientDir);

      for (const fileName of files) {
        const filePath = join(clientDir, fileName);
        const fileStat = statSync(filePath);

        // Skip directories if any
        if (fileStat.isDirectory()) continue;

        // Grace period check: Skip files created/modified within the last 1 hour
        const fileAge = now - fileStat.mtimeMs;
        if (fileAge < gracePeriodMs) {
          console.log(`[Cleanup] Skipping recent file: ${clientName}/${fileName} (Age: ${Math.round(fileAge / 1000 / 60)} mins)`);
          continue;
        }

        // Query database to check if this file is linked to any case
        const url1 = `/api/cases/files?labName=${encodeURIComponent(clientName)}&fileName=${encodeURIComponent(fileName)}`;
        const url2 = `/api/cases/files?labName=${clientName}&fileName=${fileName}`;

        const matches = await db.select()
          .from(caseFiles)
          .where(
            or(
              eq(caseFiles.fileUrl, url1),
              eq(caseFiles.fileUrl, url2)
            )
          )
          .limit(1);

        if (matches.length === 0) {
          console.log(`[Cleanup] Deleting unlinked file: ${clientName}/${fileName}`);
          try {
            unlinkSync(filePath);
          } catch (err: any) {
            console.error(`[Cleanup] Failed to delete file ${filePath}:`, err.message);
          }
        }
      }

      // If the client folder is now empty, delete it to keep case_data clean
      try {
        const remaining = readdirSync(clientDir);
        if (remaining.length === 0) {
          console.log(`[Cleanup] Removing empty client directory: ${clientName}`);
          rmdirSync(clientDir);
        }
      } catch (err: any) {
        console.error(`[Cleanup] Failed to remove empty client directory ${clientDir}:`, err.message);
      }
    }
    console.log('[Cleanup] case_data background cleanup completed successfully.');
  } catch (error: any) {
    console.error('[Cleanup] Error during background cleanup:', error);
  }
}

// Support running directly from command line (e.g. via npx tsx)
if (require.main === module) {
  runCleanup().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
