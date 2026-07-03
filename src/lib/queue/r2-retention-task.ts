import 'dotenv/config';
import { R2_BUCKET } from '../r2';
import { listAllR2Objects, deleteKeys } from '../r2-objects';

/**
 * R2 age-based retention.
 *
 * Deletes EVERY object in the bucket that has been stored for at least
 * RETENTION_MONTHS (default 3), regardless of whether it is still referenced by
 * a case. This is an unconditional retention policy — old files are removed even
 * if a case still links to them, which will break those cases' downloads. Runs
 * quarterly via r2-retention-scheduler.ts.
 *
 * Age is measured from each object's R2 LastModified timestamp.
 *
 * Run directly:   npx tsx src/lib/queue/r2-retention-task.ts
 *   --dry-run     list what would be deleted without deleting
 */

const RETENTION_MONTHS = Number(process.env.R2_RETENTION_MONTHS) || 3;

/** The oldest LastModified an object may have and still be kept. */
function retentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
}

export async function runR2Retention(options: { dryRun?: boolean } = {}): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const cutoff = retentionCutoff();

  console.log(
    `[R2 Retention] Deleting objects stored on/before ${cutoff.toISOString()} ` +
      `(>= ${RETENTION_MONTHS} months old) from bucket "${R2_BUCKET}"${dryRun ? ' (DRY RUN)' : ''}.`
  );

  const objects = await listAllR2Objects();
  console.log(`[R2 Retention] ${objects.length} objects found in the bucket.`);

  const toDelete: string[] = [];
  let skippedRecent = 0;
  let skippedNoDate = 0;

  for (const obj of objects) {
    if (!obj.lastModified) {
      // Without a timestamp we can't prove the object is old enough — keep it.
      skippedNoDate++;
      continue;
    }
    if (obj.lastModified.getTime() <= cutoff.getTime()) {
      toDelete.push(obj.key);
    } else {
      skippedRecent++;
    }
  }

  console.log(
    `[R2 Retention] ${toDelete.length} object(s) meet the age threshold ` +
      `(kept: ${skippedRecent} newer than cutoff${skippedNoDate ? `, ${skippedNoDate} with no timestamp` : ''}).`
  );

  if (toDelete.length === 0) {
    console.log('[R2 Retention] Nothing to delete. Done.');
    return;
  }

  if (dryRun) {
    for (const key of toDelete) console.log(`[R2 Retention] [dry-run] would delete: ${key}`);
    console.log(`[R2 Retention] DRY RUN complete — ${toDelete.length} object(s) would be deleted.`);
    return;
  }

  const deleted = await deleteKeys(toDelete);
  console.log(`[R2 Retention] Complete — deleted ${deleted}/${toDelete.length} object(s).`);
}

// Support running directly: npx tsx src/lib/queue/r2-retention-task.ts [--dry-run]
if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  runR2Retention({ dryRun: args.has('--dry-run') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[R2 Retention] Fatal error:', err);
      process.exit(1);
    });
}
