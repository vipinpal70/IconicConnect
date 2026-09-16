/**
 * R2-backed {@link RangeReader} — byte-ranges a ZIP object in R2 so the 3Shape
 * extractor reads only the central directory and the order XML, never the whole
 * multi-GB archive (xml-work-plan.md §5).
 *
 * The app runs as a long-lived PM2 process capped at 2 GB RSS
 * (`ecosystem.config.js`); a `GetObject` of a full package would blow it.
 */
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/src/lib/r2'
import type { RangeReader } from './zip'

/**
 * Build a `RangeReader` for the R2 object at `key`. `size()` is cached after the
 * first `HEAD`. Every `read()` is one ranged `GetObject`.
 */
export function r2RangeReader(key: string): RangeReader {
  let cachedSize: number | null = null

  return {
    async size() {
      if (cachedSize !== null) return cachedSize
      const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
      if (typeof head.ContentLength !== 'number') {
        throw new Error(`R2 object ${key} has no ContentLength`)
      }
      cachedSize = head.ContentLength
      return cachedSize
    },

    async read(offset: number, length: number) {
      if (length <= 0) return Buffer.alloc(0)
      const end = offset + length - 1
      const res = await r2.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Range: `bytes=${offset}-${end}`,
        }),
      )
      if (!res.Body) throw new Error(`R2 GetObject ${key} bytes=${offset}-${end} returned no body`)
      // AWS SDK v3 Node stream helper.
      const bytes = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
      return Buffer.from(bytes)
    },
  }
}
