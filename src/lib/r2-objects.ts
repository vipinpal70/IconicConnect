import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from './r2';

/**
 * Rebuild the R2 object key from a stored proxy URL (`/api/cases/files?labName=&fileName=`).
 * Returns null for anything that isn't that shape (e.g. legacy Supabase public URLs, which
 * don't live in R2, or a raw key already — some columns, like milling_centers.contract_doc_key,
 * store the bucket key directly instead of a proxy URL and don't go through this).
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

/** Every object currently in the R2 bucket, paginated. */
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
      if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Delete keys in batches of 1000 (the DeleteObjects limit). Returns the count actually deleted. */
export async function deleteKeys(keys: string[]): Promise<number> {
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
  return deleted;
}
