import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/src/lib/r2'

/**
 * Server-side upload of a small file to R2 under the existing `${labName}/${fileName}` key scheme and
 * returns the proxy URL the rest of the app already understands. (Replaces Supabase Storage.)
 */
export async function putLabFile(labName: string, fileName: string, file: File): Promise<string> {
  const key = `${labName}/${fileName}`
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type || 'application/octet-stream',
  }))
  return `/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`
}
