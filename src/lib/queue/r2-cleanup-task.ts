import 'dotenv/config';
import { db } from '../../db';
import { caseFiles, cases } from '../../db/schema/case';
import { chatMessages } from '../../db/schema/chat';
import { isNotNull } from 'drizzle-orm';
import { R2_BUCKET } from '../r2';
import { listAllR2Objects, deleteKeys } from '../r2-objects';

/**
 * R2 orphan cleanup.
 *
 * Every file uploaded through the multipart uploader lands in R2 under the key
 * `${labName}/${fileName}` and is referenced from the database as an auth-proxy
 * URL: `/api/cases/files?labName=<lab>&fileName=<file>`.
 *
 * An R2 object becomes orphaned when no database row references it — e.g. an
 * upload completed but the case/attachment record was never committed (abandoned
 * form, failed insert), or a client's cases were deleted while their objects
 * stayed behind. This task lists the bucket, subtracts everything still
 * referenced in the DB, and deletes the remainder.
 *
 * Run directly:   npx tsx src/lib/queue/r2-cleanup-task.ts
 *   --dry-run     list what would be deleted without deleting
 *   --force       delete even if the DB reports zero references (see safety valve)
 */

// Keep objects modified within this window. A completed multipart upload writes
// the R2 object slightly before the app commits the DB row, so a fresh unlinked
// object is normal and must not be reaped. Configurable via env; defaults to 2h,
// comfortably longer than the gap between upload-complete and DB insert.
const GRACE_PERIOD_MS =
  (Number(process.env.R2_CLEANUP_GRACE_HOURS) || 2) * 60 * 60 * 1000;

/**
 * Rebuild the R2 object key from a stored proxy URL.
 * Returns null for anything that isn't an `/api/cases/files` proxy URL
 * (e.g. legacy Supabase public URLs, which don't live in R2).
 */
function keyFromProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return null;
  if (!url.slice(0, qIndex).endsWith('/api/cases/files')) return null;

  const params = new URLSearchParams(url.slice(qIndex + 1));
  const labName = params.get('labName'); // URLSearchParams decodes for us
  const fileName = params.get('fileName');
  if (!labName || !fileName) return null;

  // Mirrors objectKey() in the upload/download routes: `${labName}/${fileName}`
  return `${labName}/${fileName}`;
}

export async function runR2Cleanup(
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;

  console.log(
    `[R2 Cleanup] Starting cleanup for bucket "${R2_BUCKET}"${dryRun ? ' (DRY RUN)' : ''}.`
  );

  // 1. Collect every R2 key referenced anywhere in the database.
  const [attachmentRows, caseRows, chatRows] = await Promise.all([
    db.select({ fileUrl: caseFiles.fileUrl }).from(caseFiles),
    db
      .select({
        outputFile: cases.outputFile,
        previewFile: cases.previewFile,
        teethLibraryFileUrl: cases.teethLibraryFileUrl,
      })
      .from(cases),
    db
      .select({ fileUrl: chatMessages.fileUrl })
      .from(chatMessages)
      .where(isNotNull(chatMessages.fileUrl)),
  ]);

  const referencedKeys = new Set<string>();
  const protect = (url: string | null | undefined) => {
    const key = keyFromProxyUrl(url);
    if (key) referencedKeys.add(key);
  };

  attachmentRows.forEach((r) => protect(r.fileUrl));
  caseRows.forEach((r) => {
    protect(r.outputFile);
    protect(r.previewFile);
    protect(r.teethLibraryFileUrl);
  });
  chatRows.forEach((r) => protect(r.fileUrl));

  console.log(`[R2 Cleanup] ${referencedKeys.size} R2 keys are referenced by the database.`);

  // 2. List the bucket.
  const objects = await listAllR2Objects();
  console.log(`[R2 Cleanup] ${objects.length} objects found in the bucket.`);

  // 3. Partition into keep / delete.
  const now = Date.now();
  const toDelete: string[] = [];
  let skippedLinked = 0;
  let skippedRecent = 0;

  for (const obj of objects) {
    if (referencedKeys.has(obj.key)) {
      skippedLinked++;
      continue;
    }
    if (obj.lastModified && now - obj.lastModified.getTime() < GRACE_PERIOD_MS) {
      skippedRecent++;
      continue;
    }
    toDelete.push(obj.key);
  }

  // Safety valve: a DB glitch that returns zero references would otherwise wipe
  // the whole bucket. Refuse to mass-delete on an empty reference set unless the
  // caller explicitly forces it.
  if (referencedKeys.size === 0 && toDelete.length > 0 && !force) {
    console.error(
      `[R2 Cleanup] ABORTING: database reported 0 referenced keys but ${toDelete.length} objects ` +
        `are eligible for deletion. This usually means a query failed. Re-run with --force to override.`
    );
    return;
  }

  console.log(
    `[R2 Cleanup] ${toDelete.length} orphaned object(s) to delete ` +
      `(protected: ${skippedLinked} linked, ${skippedRecent} within grace period).`
  );

  if (toDelete.length === 0) {
    console.log('[R2 Cleanup] Nothing to delete. Done.');
    return;
  }

  if (dryRun) {
    for (const key of toDelete) console.log(`[R2 Cleanup] [dry-run] would delete: ${key}`);
    console.log(`[R2 Cleanup] DRY RUN complete — ${toDelete.length} object(s) would be deleted.`);
    return;
  }

  const deleted = await deleteKeys(toDelete);
  console.log(`[R2 Cleanup] Complete — deleted ${deleted}/${toDelete.length} orphaned object(s).`);
}

// Support running directly: npx tsx src/lib/queue/r2-cleanup-task.ts [--dry-run] [--force]
if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  runR2Cleanup({ dryRun: args.has('--dry-run'), force: args.has('--force') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[R2 Cleanup] Fatal error:', err);
      process.exit(1);
    });
}
