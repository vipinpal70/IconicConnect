/**
 * Minimal ZIP reader (central-directory walk + stored/deflate entries).
 *
 * Real cases arrive from the lab as a single .zip, so the extractor has to
 * read one without pulling a dependency into the project. Encrypted entries
 * (3Shape's `.3ml` design files are password-protected) are reported but not
 * decoded — nothing we need for case creation lives in them.
 */
import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const CDH_SIG = 0x02014b50

function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/**
 * @returns {{ name: string, size: number, compressedSize: number, encrypted: boolean,
 *             method: number, offset: number }[]}
 */
export function listZip(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record)')

  let count = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)

  // ZIP64: the 32-bit fields saturate, real values live in the ZIP64 EOCD.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOCATOR_SIG) {
        const z64 = Number(buf.readBigUInt64LE(i + 8))
        count = Number(buf.readBigUInt64LE(z64 + 32))
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48))
        break
      }
    }
  }

  const entries = []
  let p = cdOffset
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CDH_SIG) break
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, size, compressedSize, method, offset, encrypted: (flags & 1) === 1 })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Decompress one entry returned by {@link listZip}. */
export function readZipEntry(buf, entry) {
  if (entry.encrypted) throw new Error(`Entry is encrypted: ${entry.name}`)
  const nameLen = buf.readUInt16LE(entry.offset + 26)
  const extraLen = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`)
}

export function openZip(path) {
  const buf = readFileSync(path)
  const entries = listZip(buf)
  return {
    entries,
    /** @param {(e: { name: string }) => boolean} predicate */
    read(predicate) {
      const entry = entries.find(predicate)
      return entry ? readZipEntry(buf, entry) : null
    },
  }
}
