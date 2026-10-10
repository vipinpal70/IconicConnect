import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from './r2';

/**
 * Rebuild the R2 object key from a stored proxy URL (`/api/cases/files?labName=&fileName=`).
 * Returns null for anything that isn't that shape (e.g. legacy Supabase public URLs, which
 * don't live in R2, or a raw key already).
 *
 * Shared by r2-cleanup-task.ts and r2-retention-task.ts — both need to resolve exactly the
 * same DB-reference → R2-key mapping, so this lives in one place rather than two copies that
 * can silently drift apart.
 */
export function keyFromProxyUrl(url: string | null | undefined): string | null {
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

/**
 * Key prefixes that belong to infrastructure, not to the app's own files — database backups live here
 * (deploy/backup-to-r2.sh). The orphan sweep and the retention job delete anything that is not referenced by the
 * database / is old, so without this guard they would delete the backups. Protected keys are (1) never listed and
 * (2) refused by deleteKeys() — two independent layers.
 */
export const PROTECTED_KEY_PREFIXES = ['db-backups/'] as const;
export const isProtectedKey = (key: string): boolean => PROTECTED_KEY_PREFIXES.some((p) => key.startsWith(p));

/** Every object currently in the R2 bucket, paginated (protected infrastructure prefixes excluded). */
export async function listAllR2Objects(): Promise<Array<{ key: string; lastModified?: Date }>> {
  const objects: Array<{ key: string; lastModified?: Date }> = [];
  let continuationToken: string | undefined;

  do {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && !isProtectedKey(obj.Key)) objects.push({ key: obj.Key, lastModified: obj.LastModified });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Delete keys in batches of 1000 (the DeleteObjects limit). Returns the count actually deleted. */
export async function deleteKeys(requested: string[]): Promise<number> {
  const keys = requested.filter((k) => !isProtectedKey(k)); // never delete backups, whoever asks
  if (keys.length !== requested.length) console.error(`[R2] refused to delete ${requested.length - keys.length} protected key(s)`);
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await r2.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    deleted += batch.length - (res.Errors?.length ?? 0);
    for (const err of res.Errors ?? []) {
      console.error(`[R2] Failed to delete ${err.Key}: ${err.Code} ${err.Message}`);
    }
  }
  // Protected keys were refused on purpose; they count as handled so callers do not retry forever.
  return deleted + (requested.length - keys.length);
}
