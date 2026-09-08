import { describe, expect, it } from 'vitest'
import {
  bufferRangeReader,
  InflateLimitError,
  NotAZipError,
  openZip,
  readCentralDirectory,
  readZipEntry,
} from '../zip'
import { makeZip, trackingReader } from './_zipfix'

describe('zip reader', () => {
  it('lists the central directory of a deflate + stored archive', async () => {
    const zip = makeZip([
      { name: 'a.xml', data: '<x>hello</x>', method: 'deflate' },
      { name: 'dir/b.txt', data: 'plain', method: 'store' },
    ])
    const entries = await readCentralDirectory(bufferRangeReader(zip))
    expect(entries.map((e) => e.name)).toEqual(['a.xml', 'dir/b.txt'])
    expect(entries[0].method).toBe(8)
    expect(entries[1].method).toBe(0)
  })

  it('round-trips entry content (deflate and stored)', async () => {
    const big = 'x'.repeat(5000)
    const zip = makeZip([
      { name: 'a.xml', data: big, method: 'deflate' },
      { name: 'b.bin', data: Buffer.from([1, 2, 3, 4, 5]), method: 'store' },
    ])
    const reader = bufferRangeReader(zip)
    const entries = await readCentralDirectory(reader)
    expect((await readZipEntry(reader, entries[0])).toString('utf8')).toBe(big)
    expect([...(await readZipEntry(reader, entries[1]))]).toEqual([1, 2, 3, 4, 5])
  })

  it('never reads the whole archive — only the tail, the CD and the wanted entry', async () => {
    // Pad with a large stored blob so "whole file" is obviously bigger than what we read.
    const filler = Buffer.alloc(400_000, 7)
    const zip = makeZip([
      { name: 'filler.bin', data: filler, method: 'store' },
      { name: 'order.xml', data: '<DentalContainer/>', method: 'deflate' },
    ])
    const t = trackingReader(zip)
    const z = await openZip(t.reader)
    await z.read((e) => e.name === 'order.xml')
    expect(t.bytesRead()).toBeLessThan(zip.length)
    // the giant filler entry's body is never fetched
    expect(t.reads.every((r) => r.length < 100_000)).toBe(true)
  })

  it('throws NotAZipError when there is no EOCD', async () => {
    await expect(readCentralDirectory(bufferRangeReader(Buffer.from('not a zip at all')))).rejects.toBeInstanceOf(
      NotAZipError,
    )
  })

  it('enforces the inflate ceiling', async () => {
    const zip = makeZip([{ name: 'big.xml', data: 'y'.repeat(2000), method: 'deflate' }])
    const reader = bufferRangeReader(zip)
    const [entry] = await readCentralDirectory(reader)
    await expect(readZipEntry(reader, entry, 100)).rejects.toBeInstanceOf(InflateLimitError)
  })
})
