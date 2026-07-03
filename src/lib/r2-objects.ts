import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from './r2';

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
