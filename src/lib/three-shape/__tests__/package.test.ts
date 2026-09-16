import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPackage } from '../package'
import { bufferRangeReader } from '../zip'
import { buildOrderXml, makeZip } from './_zipfix'

describe('extractPackage — one order per zip (Q4)', () => {
  it('extracts a single-order package', async () => {
    const xml = buildOrderXml(
      [
        { unn: 12, cls: 'teCrown' },
        { unn: 13, cls: 'teCrownPontic' },
        { unn: 14, cls: 'teCrown' },
      ],
      { intOrderId: 'CASE_A', items: 'Anatomy bridge 24-26', connectors: [[12, 13], [13, 14]] },
    )
    const zip = makeZip([{ name: 'CASE_A.xml', data: xml }])
    const res = await extractPackage(bufferRangeReader(zip), 'CASE_A.zip')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.category).toBe('Crown & Bridges')
    expect(res.draft.subTypeData.caseType).toBe('Bridge')
    expect(res.draft.subTypeData.teeth).toEqual([12, 13, 14])
    expect(res.threeShape.classification.toothNumbers).toEqual([12, 13, 14])
    expect(res.threeShape.source.parserVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('rejects a zip with more than one order XML', async () => {
    const a = buildOrderXml([{ unn: 5, cls: 'teCrown' }], { intOrderId: 'A' })
    const b = buildOrderXml([{ unn: 9, cls: 'teCrown' }], { intOrderId: 'B' })
    const zip = makeZip([
      { name: 'A.xml', data: a },
      { name: 'B.xml', data: b },
    ])
    const res = await extractPackage(bufferRangeReader(zip), 'batch.zip')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('MULTIPLE_ORDER_XML')
  })

  it('rejects an order XML that holds more than one <TDM_Item_Order>', async () => {
    const xml = buildOrderXml([{ unn: 5, cls: 'teCrown' }], { orderRecords: 2 })
    const zip = makeZip([{ name: 'weird.xml', data: xml }])
    const res = await extractPackage(bufferRangeReader(zip), 'weird.zip')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('MULTIPLE_ORDER_XML')
  })

  it('treats a mesh-only package as a raw-scan draft, not an error', async () => {
    const zip = makeZip([
      { name: 'CN1_upper.stl', data: Buffer.alloc(2048, 1), method: 'store' },
      { name: 'CN1_lower.stl', data: Buffer.alloc(2048, 2), method: 'store' },
    ])
    const res = await extractPackage(bufferRangeReader(zip), 'CN1.zip')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.category).toBeNull()
    expect(res.threeShape.dataQuality.warnings.some((w) => w.code === 'NO_ORDER_XML')).toBe(true)
  })

  it('errors when there is neither an order nor a mesh', async () => {
    const zip = makeZip([{ name: 'readme.txt', data: 'nothing useful' }])
    const res = await extractPackage(bufferRangeReader(zip), 'empty.zip')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('NO_ORDER_AND_NO_MESHES')
  })

  it('flags a double-zipped package (zip inside a zip)', async () => {
    const inner = makeZip([{ name: 'x.stl', data: Buffer.alloc(128, 1), method: 'store' }])
    const zip = makeZip([
      { name: 'D. Leblanc/D. Leblanc New.zip', data: inner, method: 'store' },
      { name: 'D. Leblanc/', data: '' },
    ])
    const res = await extractPackage(bufferRangeReader(zip), 'D. Leblanc.zip')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('NESTED_ZIP')
    expect(res.error.message).toMatch(/D\. Leblanc New\.zip/)
  })

  it('errors on a non-zip', async () => {
    const res = await extractPackage(bufferRangeReader(Buffer.from('definitely not a zip')), 'x.zip')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('XML_UNREADABLE')
  })
})

/* --- guarded pass over the real sample packages (git-ignored: skip if absent) --- */
const CASE_DATA = 'case_data'
const dirExists = existsSync(CASE_DATA)

function findZips(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) findZips(p, acc)
    else if (e.toLowerCase().endsWith('.zip')) acc.push(p)
  }
  return acc
}

describe.runIf(dirExists)('extractPackage — real sample packages', () => {
  const zips = dirExists ? findZips(CASE_DATA) : []
  it('every sample package produces a usable result or a known error', async () => {
    for (const path of zips) {
      const name = path.split('/').pop() as string
      const res = await extractPackage(bufferRangeReader(readFileSync(path)), name)
      if (res.ok) {
        expect(['string', 'object']).toContain(typeof res.draft.subTypeData)
        expect(Array.isArray(res.threeShape.classification.toothNumbers)).toBe(true)
      } else {
        expect([
          'XML_UNREADABLE',
          'MULTIPLE_ORDER_XML',
          'ORDER_XML_NAME_MISMATCH',
          'NESTED_ZIP',
          'NO_ORDER_AND_NO_MESHES',
          'INFLATE_LIMIT',
        ]).toContain(res.error.code)
      }
    }
  })

  it('the JDE Crown (17929_*) cases classify as Crown & Bridge with the extracted teeth', async () => {
    const cases17929 = zips.filter((z) => (z.split('/').pop() as string).startsWith('17929_'))
    expect(cases17929.length).toBeGreaterThan(0)
    for (const path of cases17929) {
      const name = path.split('/').pop() as string
      const res = await extractPackage(bufferRangeReader(readFileSync(path)), name)
      expect(res.ok, name).toBe(true)
      if (!res.ok) continue
      expect(res.draft.category, name).toBe('Crown & Bridges')
      expect(res.threeShape.classification.toothNumbers.length, name).toBeGreaterThan(0)
      // teeth come from ToothElement.ToothNumber (UNN 1–32), never the Items text
      for (const t of res.threeShape.classification.toothNumbers) {
        expect(t).toBeGreaterThanOrEqual(1)
        expect(t).toBeLessThanOrEqual(32)
      }
    }
  })

  it('recovers a connector span when the case is a real multi-unit bridge', async () => {
    const path = zips.find((z) => z.includes('Darlene_Kalawsky'))
    if (!path) return
    const res = await extractPackage(bufferRangeReader(readFileSync(path)), 'Darlene.zip')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.threeShape.relationships.connectorSpans).toEqual([[5, 6]])
  })
})
