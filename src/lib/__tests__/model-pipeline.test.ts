import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'
import { classifyArchiveEntry, selectEntries } from '@/src/components/viewer3d/scan-archive'
import { loadModelData, modelExtension, transferablesOf } from '@/src/components/viewer3d/model-pipeline'
import { fileNameFromUrl, isPreviewable3DFile } from '@/src/components/viewer3d/preview-sources'

const SAMPLE_DCM = readFileSync(path.resolve(__dirname, '../../../node_modules/3shape-dcm/samples/example_ca.dcm'))

/** ASCII STL tetrahedron: 4 faces × 3 corners = 12 unshared vertices, 4 after welding. */
const TETRA_STL = `solid t
${[
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
  [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
]
  .map((f) => `facet normal 0 0 0\nouter loop\n${f.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`)
  .join('\n')}
endsolid t`

function mockFetch(bytes: Uint8Array) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as unknown as BodyInit, { headers: { 'content-length': String(bytes.byteLength) } })))
}

afterEach(() => vi.unstubAllGlobals())

describe('archive entry classification', () => {
  it('categorises by folder and extension', () => {
    expect(classifyArchiveEntry('Order/Scans/Upper.dcm')).toBe('scan')
    expect(classifyArchiveEntry('Order\\CAD\\Crown.dcm')).toBe('cad')
    expect(classifyArchiveEntry('export/crown_46.STL')).toBe('mesh')
    expect(classifyArchiveEntry('Libraries/implant.dcm')).toBe('other')
    expect(classifyArchiveEntry('__MACOSX/Scans/._Upper.dcm')).toBeNull()
    expect(classifyArchiveEntry('Order/notes.xml')).toBeNull()
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

describe('loadModelData', () => {
  it('welds STL triangles and precomputes normals, bounds and a BVH', async () => {
    mockFetch(new TextEncoder().encode(TETRA_STL))
    const model = await loadModelData(
      { url: 'https://x/crown.stl', fileName: 'crown.stl', purpose: 'design-output' },
      new AbortController().signal,
    )
    expect(model.meshes).toHaveLength(1)
    const [mesh] = model.meshes
    expect(mesh.vertexCount).toBe(4)
    expect(mesh.triangleCount).toBe(4)
    expect(mesh.normals).toHaveLength(12)
    expect(mesh.bbox).toEqual([0, 0, 0, 1, 1, 1])
    expect(mesh.bvh?.roots.length).toBeGreaterThan(0)
    expect(model.byteLength).toBeGreaterThan(0)
    // Every transferable is a distinct buffer (duplicates would throw in postMessage)
    const buffers = transferablesOf(model)
    expect(new Set(buffers).size).toBe(buffers.length)
  })

  it('reads a design-output ZIP in one pass, keeping scans alongside the designed crown', async () => {
    const zip = zipSync({
      'Order/Scans/Preparation scan.dcm': new Uint8Array(SAMPLE_DCM),
      'Order/CAD/crown.stl': new TextEncoder().encode(TETRA_STL),
      'Order/Order.xml': new TextEncoder().encode('<x/>'),
    })
    mockFetch(zip)
    const design = await loadModelData(
      { url: 'https://x/final.zip', fileName: 'final.zip', purpose: 'design-output' },
      new AbortController().signal,
    )
    expect(design.meshes.map((m) => [m.name, m.category])).toEqual([
      ['Order/Scans/Preparation scan.dcm', 'scan'],
      ['Order/CAD/crown.stl', 'mesh'],
    ])
    expect(fetch).toHaveBeenCalledTimes(1)

    mockFetch(zip)
    const submission = await loadModelData(
      { url: 'https://x/final.zip', fileName: 'final.zip', purpose: 'case-submission' },
      new AbortController().signal,
    )
    expect(submission.meshes.map((m) => m.category)).toEqual(['scan'])
    expect(submission.meshes[0].vertexCount).toBeGreaterThan(0)
  })

  it('explains when a ZIP has nothing to preview', async () => {
    mockFetch(zipSync({ 'readme.txt': new TextEncoder().encode('hi') }))
    await expect(
      loadModelData({ url: 'https://x/a.zip', fileName: 'a.zip', purpose: 'case-submission' }, new AbortController().signal),
    ).rejects.toThrow(/No 3D meshes/)
  })
})
