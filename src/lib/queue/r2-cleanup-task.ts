import 'dotenv/config';
import { db } from '../../db';
import { caseFiles, casePreviewFiles, caseReferenceFiles, caseHoldFiles, cases } from '../../db/schema/case';
import { chatMessages } from '../../db/schema/chat';
import { millingCenters } from '../../db/schema/milling';
import { isNotNull } from 'drizzle-orm';
import { R2_BUCKET } from '../r2';
import { listAllR2Objects, deleteKeys, keyFromProxyUrl } from '../r2-objects';

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
 * ── Every writer into R2_BUCKET, and where its reference lives (keep this list
 * exhaustive — an object here whose reference isn't protected below gets deleted
 * the same as a genuine orphan) ──
 *   - POST /api/cases/upload            → proxy URL in case_files / case_preview_files /
 *                                          case_reference_files / case_hold_files / cases.
 *                                          (output|preview|teethLibrary)File / chat_messages
 *   - POST /api/cases/bulk/upload       → staged under `bulk-staging/`, never referenced
 *                                          directly — bulk/confirm COPYs it to a proxy-URL
 *                                          key above (or it's abandoned and SHOULD be reaped)
 *   - POST /api/admin/milling/centers/[id]/contract → RAW key (no proxy URL) in
 *                                          milling_centers.contract_doc_key
 * If you add a new upload route, add its reference column to the `protect*` calls below
 * in the same commit — this file has already had two silent, live gaps found this way
 * (hold images, then milling contract docs) before this comment existed.
 *
 * Run directly:   npx tsx src/lib/queue/r2-cleanup-task.ts
 *   --dry-run     list what would be deleted without deleting
 *   --force       delete even if the DB reports zero references, or if the batch
 *                 trips the mass-deletion circuit breaker (see safety valves)
 */

// Keep objects modified within this window. A completed multipart upload writes
// the R2 object slightly before the app commits the DB row, so a fresh unlinked
// object is normal and must not be reaped. Configurable via env; defaults to 2h,
// comfortably longer than the gap between upload-complete and DB insert.
const GRACE_PERIOD_MS =
  (Number(process.env.R2_CLEANUP_GRACE_HOURS) || 2) * 60 * 60 * 1000;

export async function runR2Cleanup(
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;

  console.log(
    `[R2 Cleanup] Starting cleanup for bucket "${R2_BUCKET}"${dryRun ? ' (DRY RUN)' : ''}.`
  );

  // 1. Collect every R2 key referenced anywhere in the database.
  const [attachmentRows, previewFileRows, referenceImageRows, holdFileRows, caseRows, chatRows, millingCenterRows] = await Promise.all([
    db.select({ fileUrl: caseFiles.fileUrl }).from(caseFiles),
    db.select({ fileUrl: casePreviewFiles.fileUrl }).from(casePreviewFiles),
    db.select({ fileUrl: caseReferenceFiles.fileUrl }).from(caseReferenceFiles),
    db.select({ fileUrl: caseHoldFiles.fileUrl }).from(caseHoldFiles),
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
    db
      .select({ contractDocKey: millingCenters.contractDocKey })
      .from(millingCenters)
      .where(isNotNull(millingCenters.contractDocKey)),
  ]);

  const referencedKeys = new Set<string>();
  const protect = (url: string | null | undefined) => {
    const key = keyFromProxyUrl(url);
    if (key) referencedKeys.add(key);
  };
  // For columns that store the raw R2 key directly (not a `/api/cases/files`
  // proxy URL) — currently just milling_centers.contract_doc_key.
  const protectRawKey = (key: string | null | undefined) => {
    if (key) referencedKeys.add(key);
  };

  attachmentRows.forEach((r) => protect(r.fileUrl));
  previewFileRows.forEach((r) => protect(r.fileUrl));
  referenceImageRows.forEach((r) => protect(r.fileUrl));
  holdFileRows.forEach((r) => protect(r.fileUrl));
  caseRows.forEach((r) => {
    protect(r.outputFile);
    protect(r.previewFile);
    protect(r.teethLibraryFileUrl);
  });
  chatRows.forEach((r) => protect(r.fileUrl));
  millingCenterRows.forEach((r) => protectRawKey(r.contractDocKey));

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

  // Safety valve 1: a DB glitch that returns zero references would otherwise wipe
  // the whole bucket. Refuse to mass-delete on an empty reference set unless the
  // caller explicitly forces it.
  if (referencedKeys.size === 0 && toDelete.length > 0 && !force) {
    console.error(
      `[R2 Cleanup] ABORTING: database reported 0 referenced keys but ${toDelete.length} objects ` +
        `are eligible for deletion. This usually means a query failed. Re-run with --force to override.`
    );
    return;
  }

  // Safety valve 2 — mass-deletion circuit breaker: a genuinely abandoned upload
  // is a handful of objects at a time. A batch this large almost always means a
  // NEW writer path was added into R2_BUCKET without adding its reference column
  // to step 1 above (this has already happened twice — see the comment at the top
  // of this file) — every one of that writer's objects looks unreferenced and
  // ages past the grace period together. Refuse to run unattended past this size;
  // an operator must look at --dry-run output and explicitly --force it through.
  const CIRCUIT_BREAKER_COUNT = Number(process.env.R2_CLEANUP_MAX_DELETE) || 100;
  const CIRCUIT_BREAKER_RATIO = 0.2; // >20% of the whole bucket in one run
  if (
    !force &&
    toDelete.length > CIRCUIT_BREAKER_COUNT &&
    objects.length > 0 &&
    toDelete.length / objects.length > CIRCUIT_BREAKER_RATIO
  ) {
    console.error(
      `[R2 Cleanup] ABORTING: ${toDelete.length}/${objects.length} objects ` +
        `(${Math.round((toDelete.length / objects.length) * 100)}%) are eligible for deletion — ` +
        `over the ${CIRCUIT_BREAKER_COUNT}-object / ${CIRCUIT_BREAKER_RATIO * 100}% circuit-breaker threshold. ` +
        `Run with --dry-run to inspect the list before deciding this is really expected, then re-run with --force.`
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
