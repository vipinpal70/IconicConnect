/**
 * Minimal ZIP reader — central-directory walk + stored/deflate entries.
 *
 * TypeScript port of `scripts/case-xml-extract/lib/zip.mjs`, refactored around a
 * `RangeReader` so the R2 backend (`r2-zip.ts`) can byte-range the central
 * directory and individual entries **without downloading the whole archive**
 * (xml-work-plan.md §5). A 3Shape package is often multi-GB (CAD + scans) while
 * the order XML is a few dozen KB.
 *
 * Encrypted entries (3Shape's `.3ml` design files are password-protected) are
 * reported but never decoded — nothing needed for case creation lives in them.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const CDH_SIG = 0x02014b50

/** Hard ceiling on central-directory records we will walk. */
const MAX_CD_ENTRIES = 5000

export class ZipError extends Error {}
export class NotAZipError extends ZipError {}
export class EncryptedEntryError extends ZipError {}
export class UnsupportedCompressionError extends ZipError {}
export class InflateLimitError extends ZipError {}

export interface ZipEntry {
  /** Full path inside the archive, e.g. `CAD/17929 0.dcm`. */
  name: string
  /** Uncompressed size (bytes), from the central-directory header. */
  size: number
  /** Compressed size (bytes), from the central-directory header — authoritative. */
  compressedSize: number
  /** Compression method: 0 = stored, 8 = deflate. */
  method: number
  /** Absolute offset of this entry's local file header in the archive. */
  localHeaderOffset: number
  /** Bit 0 of the general-purpose flags — the entry is password-protected. */
  encrypted: boolean
}

/**
 * Reads `length` bytes starting at `offset` from the archive. Implementations:
 * `bufferRangeReader` (a full Buffer, for tests / small local files) and the R2
 * `GetObject` Range reader in `r2-zip.ts`.
 */
export interface RangeReader {
  /** Total archive size in bytes. */
  size(): Promise<number>
  read(offset: number, length: number): Promise<Buffer>
}

/** A `RangeReader` over an in-memory Buffer. */
export function bufferRangeReader(buf: Buffer): RangeReader {
  return {
    size: async () => buf.length,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, buf.length))
      const end = Math.max(start, Math.min(offset + length, buf.length))
      return buf.subarray(start, end)
    },
  }
}

interface Eocd {
  count: number
  cdOffset: number
  cdSize: number
}

/**
 * Locate and parse the End Of Central Directory record (classic or ZIP64) by
 * range-reading only the archive's tail.
 */
async function readEocd(reader: RangeReader): Promise<Eocd> {
  const total = await reader.size()
  if (total < 22) throw new NotAZipError('Not a ZIP archive (too small for an EOCD record)')

  // Classic EOCD is 22 bytes + up to 0xffff of trailing comment.
  const tailLen = Math.min(total, 0xffff + 22)
  const tailStart = total - tailLen
  const tail = await reader.read(tailStart, tailLen)

  let eocdRel = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocdRel = i
      break
    }
  }
  if (eocdRel < 0) {
    throw new NotAZipError('Not a ZIP archive (no end-of-central-directory record)')
  }

  let count = tail.readUInt16LE(eocdRel + 10)
  let cdSize = tail.readUInt32LE(eocdRel + 12)
  let cdOffset = tail.readUInt32LE(eocdRel + 16)

  // ZIP64: the 32-bit fields saturate; real values live in the ZIP64 EOCD.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const eocdAbs = tailStart + eocdRel
    // The ZIP64 EOCD locator sits 20 bytes before the classic EOCD.
    const locAbs = eocdAbs - 20
    if (locAbs < 0) throw new NotAZipError('ZIP64 markers present but no ZIP64 EOCD locator')
    const locBuf =
      locAbs >= tailStart
        ? tail.subarray(locAbs - tailStart, locAbs - tailStart + 20)
        : await reader.read(locAbs, 20)
    if (locBuf.readUInt32LE(0) !== EOCD64_LOCATOR_SIG) {
      throw new NotAZipError('ZIP64 EOCD locator signature not found')
    }
    const z64Abs = Number(locBuf.readBigUInt64LE(8))
    // ZIP64 EOCD record: fixed fields at the start are all we need.
    const z64 = await reader.read(z64Abs, 56)
    count = Number(z64.readBigUInt64LE(32))
    cdSize = Number(z64.readBigUInt64LE(40))
    cdOffset = Number(z64.readBigUInt64LE(48))
  }

  return { count, cdOffset, cdSize }
}

/** Walk the central directory and return every entry (no data read). */
export async function readCentralDirectory(reader: RangeReader): Promise<ZipEntry[]> {
  const { count, cdOffset, cdSize } = await readEocd(reader)
  const cd = await reader.read(cdOffset, cdSize)

  const entries: ZipEntry[] = []
  let p = 0
  const limit = Math.min(count, MAX_CD_ENTRIES)
  for (let i = 0; i < limit && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== CDH_SIG) break
    const flags = cd.readUInt16LE(p + 8)
    const method = cd.readUInt16LE(p + 10)
    const compressedSize = cd.readUInt32LE(p + 20)
    const size = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const localHeaderOffset = cd.readUInt32LE(p + 42)
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({
      name,
      size,
      compressedSize,
      method,
      localHeaderOffset,
      encrypted: (flags & 1) === 1,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Decompress one entry. `maxInflateBytes` caps the uncompressed size we will
 * accept (zip-bomb guard — xml-work-plan.md §5.2 / §14); an entry over the cap
 * throws {@link InflateLimitError}.
 */
export async function readZipEntry(
  reader: RangeReader,
  entry: ZipEntry,
  maxInflateBytes = 25 * 1024 * 1024,
): Promise<Buffer> {
  if (entry.encrypted) throw new EncryptedEntryError(`Entry is encrypted: ${entry.name}`)
  if (entry.size > maxInflateBytes) {
    throw new InflateLimitError(
      `Entry ${entry.name} uncompressed size ${entry.size} exceeds the ${maxInflateBytes}-byte ceiling`,
    )
  }

  // The local header repeats name/extra with lengths that can differ from the
  // central-directory copy, so read the 30-byte fixed part first.
  const lh = await reader.read(entry.localHeaderOffset, 30)
  const lhNameLen = lh.readUInt16LE(26)
  const lhExtraLen = lh.readUInt16LE(28)
  const dataStart = entry.localHeaderOffset + 30 + lhNameLen + lhExtraLen

  // Use the CENTRAL-DIRECTORY compressedSize: entries written in streaming mode
  // leave the local-header sizes as 0 with a trailing data descriptor.
  const raw = await reader.read(dataStart, entry.compressedSize)

  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) {
    const out = inflateRawSync(raw)
    if (out.length > maxInflateBytes) {
      throw new InflateLimitError(
        `Entry ${entry.name} inflated to ${out.length} bytes, over the ${maxInflateBytes}-byte ceiling`,
      )
    }
    return out
  }
  throw new UnsupportedCompressionError(
    `Unsupported compression method ${entry.method} for ${entry.name}`,
  )
}

/**
 * Convenience wrapper: open an archive and expose its entry list plus a reader
 * for individual entries. Mirrors the toolkit's `openZip(path)` shape but async
 * and reader-backed.
 */
export interface OpenZip {
  entries: ZipEntry[]
  read(predicate: (e: ZipEntry) => boolean, maxInflateBytes?: number): Promise<Buffer | null>
}

export async function openZip(reader: RangeReader): Promise<OpenZip> {
  const entries = await readCentralDirectory(reader)
  return {
    entries,
    async read(predicate, maxInflateBytes) {
      const entry = entries.find(predicate)
      return entry ? readZipEntry(reader, entry, maxInflateBytes) : null
    },
  }
}
