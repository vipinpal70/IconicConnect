import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { zipSync } from 'fflate'
import { parse as parseDcm } from '3shape-dcm'
import { classifyArchiveEntry, selectEntries } from '@/src/components/viewer3d/scan-archive'
import {
  ModelSession,
  modelExtension,
  transferablesOf,
  type ModelEvent,
} from '@/src/components/viewer3d/model-pipeline'
import { fileNameFromUrl, isPreviewable3DFile } from '@/src/components/viewer3d/preview-sources'

const SAMPLES = path.resolve(__dirname, '../../../node_modules/3shape-dcm/samples')
const SAMPLE_DCM = readFileSync(path.join(SAMPLES, 'example_ca.dcm'))

/** ASCII STL tetrahedron: 4 faces × 3 corners = 12 unshared vertices, 4 after welding. */
const TETRA_FACES = [
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
  [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
]
const TETRA_STL = `solid t
${TETRA_FACES.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}
endsolid t`

function mockFetch(bytes: Uint8Array) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as unknown as BodyInit, { headers: { 'content-length': String(bytes.byteLength) } })))
}

function newSession() {
  const events: ModelEvent[] = []
  const session = new ModelSession((event) => events.push(event))
  return { session, events }
}

/** Let the session's background queue (setTimeout-driven) run to completion. */
async function drain(events: ModelEvent[], until: (events: ModelEvent[]) => boolean) {
  for (let i = 0; i < 200 && !until(events); i++) await new Promise((r) => setTimeout(r, 5))
}

afterEach(() => vi.unstubAllGlobals())

describe('patched 3shape-dcm decoder (patches/3shape-dcm+1.0.0.patch)', () => {
  // Captured from the unpatched upstream 1.0.0 parser: the linear-time decoder must produce the
  // exact same triangles, in the same order.
  it.each([
    ['example_ca.dcm', 15510, '2a2a01f901269e34'],
    ['example_ce.dcm', 118178, '25b7393cb1f12c95'],
  ])('decodes %s identically to upstream', (file, triangles, digest) => {
    const { indices } = parseDcm(new Uint8Array(readFileSync(path.join(SAMPLES, file))))
    expect(indices.length / 3).toBe(triangles)
    const hash = createHash('sha256').update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)).digest('hex')
    expect(hash.slice(0, 16)).toBe(digest)
  })
})

describe('archive entry classification', () => {
  it('categorises by folder and extension', () => {
    expect(classifyArchiveEntry('Order/Scans/Upper.dcm')).toBe('scan')
    expect(classifyArchiveEntry('Order\\CAD\\Crown.dcm')).toBe('cad')
    expect(classifyArchiveEntry('export/crown_46.STL')).toBe('mesh')
    expect(classifyArchiveEntry('Libraries/implant.dcm')).toBe('other')
    expect(classifyArchiveEntry('__MACOSX/Scans/._Upper.dcm')).toBeNull()
    expect(classifyArchiveEntry('Order/notes.xml')).toBeNull()
  })

  it('ignores 3Shape Backup copies (they sit in another coordinate frame)', () => {
    expect(classifyArchiveEntry('Case/Backup/Scans/Upper/Raw Preparation scan.dcm')).toBeNull()
    expect(classifyArchiveEntry('Case/Scans/Upper/Raw Preparation scan.dcm')).toBe('scan')
  })

  it('shows scans for a case submission and the design in context for a design output', () => {
    const entries = [
      { name: 's', category: 'scan' as const },
      { name: 'c', category: 'cad' as const },
      { name: 'm', category: 'mesh' as const },
      { name: 'o', category: 'other' as const },
    ]
    expect(selectEntries(entries, 'case-submission').map((e) => e.name)).toEqual(['s'])
    expect(selectEntries(entries, 'design-output').map((e) => e.name)).toEqual(['s', 'c', 'm'])
    expect(selectEntries([entries[1]], 'case-submission').map((e) => e.name)).toEqual(['c'])
    expect(selectEntries([entries[3]], 'design-output').map((e) => e.name)).toEqual(['o'])
  })
})

describe('file naming helpers', () => {
  it('detects format from the fileName query param of proxy URLs', () => {
    const url = '/api/cases/files?labName=Lab&fileName=case%2042.zip'
    expect(modelExtension({ url, fileName: '' })).toBe('zip')
    expect(fileNameFromUrl(url)).toBe('case 42.zip')
    expect(isPreviewable3DFile('final.STL')).toBe(true)
    expect(isPreviewable3DFile('notes.pdf')).toBe(false)
  })
})

describe('ModelSession', () => {
  it('welds STL triangles, precomputes normals and bounds, then builds the BVH in the background', async () => {
    mockFetch(new TextEncoder().encode(TETRA_STL))
    const { session, events } = newSession()
    const model = await session.load(
      { url: 'https://x/crown.stl', fileName: 'crown.stl', purpose: 'design-output' },
      new AbortController().signal,
    )
    expect(model.meshes).toHaveLength(1)
    const [mesh] = model.meshes
    expect(mesh.file).toBe('crown.stl')
    expect(mesh.vertexCount).toBe(4)
    expect(mesh.triangleCount).toBe(4)
    expect(mesh.normals).toHaveLength(12)
    expect(mesh.bbox).toEqual([0, 0, 0, 1, 1, 1])
    expect(model.files).toEqual([
      expect.objectContaining({ name: 'crown.stl', status: 'ready', defaultVisible: true }),
    ])
    // Every transferable is a distinct buffer (duplicates would throw in postMessage)
    const buffers = transferablesOf(model)
    expect(new Set(buffers).size).toBe(buffers.length)

    await drain(events, (e) => e.some((x) => x.type === 'bvh'))
    const bvh = events.find((e) => e.type === 'bvh')
    expect(bvh).toMatchObject({ type: 'bvh', mesh: 'crown.stl' })
    expect(bvh?.type === 'bvh' && bvh.bvh?.indirectBuffer).toBeTruthy()
  })

  it('reads a design-output ZIP in one pass, keeping scans alongside the designed crown', async () => {
    const zip = zipSync({
      'Order/Scans/Preparation scan.dcm': new Uint8Array(SAMPLE_DCM),
      'Order/CAD/crown.stl': new TextEncoder().encode(TETRA_STL),
      'Order/Order.xml': new TextEncoder().encode('<x/>'),
    })
    mockFetch(zip)
    const design = await newSession().session.load(
      { url: 'https://x/final.zip', fileName: 'final.zip', purpose: 'design-output' },
      new AbortController().signal,
    )
    expect(design.meshes.map((m) => [m.name, m.category])).toEqual([
      ['Order/Scans/Preparation scan.dcm', 'scan'],
      ['Order/CAD/crown.stl', 'mesh'],
    ])
    expect(fetch).toHaveBeenCalledTimes(1)

    mockFetch(zip)
    const submission = await newSession().session.load(
      { url: 'https://x/final.zip', fileName: 'final.zip', purpose: 'case-submission' },
      new AbortController().signal,
    )
    expect(submission.meshes.map((m) => m.category)).toEqual(['scan'])
    expect(submission.meshes[0].vertexCount).toBeGreaterThan(0)
  })

  it('decodes only the default-visible files and decodes hidden ones on request', async () => {
    mockFetch(
      zipSync({
        'Case/Scans/Upper/PreparationScan.dcm': new Uint8Array(SAMPLE_DCM),
        'Case/Scans/AuxScanDir/SID.BiteScan.DCM': new Uint8Array(SAMPLE_DCM),
      }),
    )
    const { session, events } = newSession()
    const model = await session.load(
      { url: 'https://x/case.zip', fileName: 'case.zip', purpose: 'case-submission' },
      new AbortController().signal,
    )
    expect(model.meshes.map((m) => m.file)).toEqual(['Case/Scans/Upper/PreparationScan.dcm'])
    expect(model.files.find((f) => f.name.endsWith('BiteScan.DCM'))).toMatchObject({
      status: 'deferred',
      defaultVisible: false,
    })

    session.decode('Case/Scans/AuxScanDir/SID.BiteScan.DCM')
    await drain(events, (e) => e.some((x) => x.type === 'meshes'))
    const decoded = events.find((e) => e.type === 'meshes')
    expect(decoded).toMatchObject({ type: 'meshes', file: { status: 'ready' } })
    expect(decoded?.type === 'meshes' && decoded.meshes[0].file).toBe('Case/Scans/AuxScanDir/SID.BiteScan.DCM')
  })

  it('keeps the case open when one file cannot be read', async () => {
    mockFetch(
      zipSync({
        'Case/Scans/Upper/PreparationScan.dcm': new Uint8Array(SAMPLE_DCM),
        'Case/Scans/Lower/AntagonistScan.dcm': new TextEncoder().encode('<not hps/>'),
      }),
    )
    const model = await newSession().session.load(
      { url: 'https://x/case.zip', fileName: 'case.zip', purpose: 'case-submission' },
      new AbortController().signal,
    )
    expect(model.meshes).toHaveLength(1)
    expect(model.files.find((f) => f.name.endsWith('AntagonistScan.dcm'))).toMatchObject({ status: 'error' })
  })

  it('skips files beyond the per-archive file limit instead of failing the archive', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 50; i++) files[`parts/part-${String(i).padStart(2, '0')}.stl`] = new TextEncoder().encode(TETRA_STL)
    mockFetch(zipSync(files))
    const model = await newSession().session.load(
      { url: 'https://x/parts.zip', fileName: 'parts.zip', purpose: 'design-output' },
      new AbortController().signal,
    )
    expect(model.files.filter((f) => f.status === 'skipped')).toHaveLength(2)
    expect(model.files.find((f) => f.status === 'skipped')?.reason).toMatch(/more than 48/)
    expect(model.meshes).toHaveLength(48)
  })

  it('explains when a ZIP has nothing to preview', async () => {
    mockFetch(zipSync({ 'readme.txt': new TextEncoder().encode('hi') }))
    await expect(
      newSession().session.load({ url: 'https://x/a.zip', fileName: 'a.zip', purpose: 'case-submission' }, new AbortController().signal),
    ).rejects.toThrow(/No 3D meshes/)
  })
})
