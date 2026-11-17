import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { defaultVisibleFiles } from '@/src/components/viewer3d/scan-visibility'
import { inferUpAxis, type OrientationInput } from '@/src/components/viewer3d/view-orientation'
import { isBinaryStl, weldBinaryStl } from '@/src/components/viewer3d/stl-weld'
import { pickAnnotation } from '@/src/components/viewer3d/annotation-picking'
import type { MeshCategory } from '@/src/components/viewer3d/scan-archive'
import type { AnnotationLayer } from '@/src/types/annotation'

const scan = (name: string) => ({ name, category: 'scan' as MeshCategory })
const mesh = (name: string) => ({ name, category: 'mesh' as MeshCategory })
const visible = (entries: Array<{ name: string; category: MeshCategory }>, purpose: 'case-submission' | 'design-output' = 'case-submission') =>
  [...defaultVisibleFiles(entries, purpose)].map((n) => n.split('/').pop()).sort()

// File layouts below are taken from real lab exports
describe('default scan visibility', () => {
  it('3Shape: hides AuxScanDir copies, keeps the main preparation and antagonist scans', () => {
    expect(
      visible([
        scan('C/Scans/AuxScanDir/SID.BiteScan.DCM'),
        scan('C/Scans/AuxScanDir/SID.LowerAntagonist.DCM'),
        scan('C/Scans/AuxScanDir/SID.UpperPrep.DCM'),
        scan('C/Scans/Lower/AntagonistScan.dcm'),
        scan('C/Scans/Upper/PreparationScan.dcm'),
      ]),
    ).toEqual(['AntagonistScan.dcm', 'PreparationScan.dcm'])
  })

  it('3Shape: prefers MB scans over raw ones and hides Misc bite scans', () => {
    expect(
      visible([
        scan('C/Scans/Lower/MB Antagonist scan.dcm'),
        scan('C/Scans/Lower/Raw Antagonist scan.dcm'),
        scan('C/Scans/Misc/B_1.dcm'),
        scan('C/Scans/Upper/MB Preparation scan.dcm'),
        scan('C/Scans/Upper/Raw Preparation scan.dcm'),
      ]),
    ).toEqual(['MB Antagonist scan.dcm', 'MB Preparation scan.dcm'])
  })

  it('3Shape: shows raw scans when they are the best available, never the pre-preparation scan', () => {
    expect(
      visible([
        scan('C/Scans/Lower/Raw Antagonist scan.dcm'),
        scan('C/Scans/Upper/PrePreparationScan.dcm'),
        scan('C/Scans/Upper/Raw Preparation scan.dcm'),
      ]),
    ).toEqual(['Raw Antagonist scan.dcm', 'Raw Preparation scan.dcm'])
  })

  it('3Shape design output: the designed restoration is always shown with the main scans', () => {
    expect(
      visible(
        [
          { name: 'C/CAD/Case 0.dcm', category: 'cad' },
          scan('C/Scans/Upper/MB Preparation scan.dcm'),
          scan('C/Scans/Upper/Raw Preparation scan.dcm'),
        ],
        'design-output',
      ),
    ).toEqual(['Case 0.dcm', 'MB Preparation scan.dcm'])
  })

  it('Medit PLY: hides the bite pieces', () => {
    expect(
      visible([mesh('x-LowerJaw.ply'), mesh('x-UpperJaw.ply'), mesh('x-TotalJaw0.ply'), mesh('x-TotalJaw1.ply')]),
    ).toEqual(['x-LowerJaw.ply', 'x-UpperJaw.ply'])
  })

  it('STL submission: hides model bases when the jaw scans are present, but not in a design output', () => {
    const entries = [mesh('K-11-modelbase.stl'), mesh('K-41-modelbase.stl'), mesh('K-LowerJaw.stl'), mesh('K-UpperJaw.stl')]
    expect(visible(entries)).toEqual(['K-LowerJaw.stl', 'K-UpperJaw.stl'])
    expect(visible(entries, 'design-output')).toHaveLength(4)
    expect(visible([mesh('K-11-modelbase.stl')])).toEqual(['K-11-modelbase.stl'])
  })

  it('never hides everything', () => {
    expect(visible([scan('C/Scans/AuxScanDir/SID.BiteScan.DCM')])).toEqual(['SID.BiteScan.DCM'])
  })
})

const box = (name: string, min: number[], max: number[], category: MeshCategory = 'scan', triangleCount = 1000): OrientationInput => ({
  name,
  category,
  bbox: [min[0], min[1], min[2], max[0], max[1], max[2]],
  triangleCount,
})

describe('up axis', () => {
  it('3Shape / iTero scans are Y-up', () => {
    expect(inferUpAxis([box('Scans/Upper/PreparationScan.dcm', [-30, 30, -15], [30, 46, 15])])).toEqual([0, 1, 0])
  })

  it('Medit / exocad scans are Z-up', () => {
    expect(inferUpAxis([box('UpperJaw.ply', [-31, -28, -2], [31, 28, 20], 'mesh')])).toEqual([0, 0, 1])
  })

  it('puts the upper jaw above the lower jaw (some exports are upside down)', () => {
    expect(
      inferUpAxis([
        box('Scans/Upper/MB Preparation scan.dcm', [35, -25, 10], [112, 0, 73]),
        box('Scans/Lower/MB Antagonist scan.dcm', [33, -12, 18], [109, 11, 69]),
      ]),
    ).toEqual([0, -1, 0])
  })

  it('ignores single crowns when scans are present', () => {
    expect(
      inferUpAxis([
        box('CAD/crown.dcm', [0, 0, 0], [12, 13, 2], 'cad', 90_000),
        box('Scans/Upper/scan.dcm', [-30, 0, -25], [30, 20, 25]),
      ]),
    ).toEqual([0, 1, 0])
  })
})

function binaryStl(faces: number[][][]): Uint8Array {
  const bytes = new Uint8Array(84 + faces.length * 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, faces.length, true)
  faces.forEach((face, t) => {
    face.forEach((v, c) => v.forEach((value, k) => view.setFloat32(84 + t * 50 + 12 + c * 12 + k * 4, value, true)))
  })
  return bytes
}

describe('binary STL welding', () => {
  const faces = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[-0, 0, 0], [0, 0, 1], [1, 0, 0]], // -0 must weld with 0
    [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  ]

  it('detects binary STL by its size, even when the header starts with "solid"', () => {
    const bytes = binaryStl(faces)
    bytes.set(new TextEncoder().encode('solid exported'), 0)
    expect(isBinaryStl(bytes)).toBe(true)
    expect(isBinaryStl(new TextEncoder().encode('solid t\nendsolid t'))).toBe(false)
  })

  it('welds shared corners and matches three.js mergeVertices', () => {
    const bytes = binaryStl(faces)
    const welded = weldBinaryStl(bytes)
    expect(welded.positions.length / 3).toBe(4)
    expect(welded.index).toHaveLength(12)

    const reference = mergeVertices(
      (() => {
        const g = new STLLoader().parse(bytes.slice().buffer)
        g.deleteAttribute('normal')
        return g
      })(),
    )
    expect(reference.getAttribute('position').count).toBe(4)
    // Same triangles, corner by corner
    for (let i = 0; i < 12; i++) {
      const a = welded.index[i]
      const b = reference.getIndex()!.getX(i)
      expect([welded.positions[a * 3], welded.positions[a * 3 + 1], welded.positions[a * 3 + 2]]).toEqual([
        reference.getAttribute('position').getX(b),
        reference.getAttribute('position').getY(b),
        reference.getAttribute('position').getZ(b),
      ])
    }
  })
})

describe('annotation picking', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(0, 0, 50)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const layer = (annotations: AnnotationLayer['annotations'], locked = false, visibleLayer = true): AnnotationLayer => ({
    id: 'l',
    name: 'L',
    color: '#fff',
    visible: visibleLayer,
    locked,
    opacity: 1,
    annotations,
  })
  const stroke = {
    id: 'stroke',
    layerId: 'l',
    type: 'brush' as const,
    color: '#f00',
    lineWidth: 4,
    createdAt: '',
    points: [
      { x: -10, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
  }
  const at = (x: number, y: number) => ({ camera, width: 800, height: 800, x, y })

  it('finds a stroke under the cursor and ignores clicks away from it', () => {
    expect(pickAnnotation([layer([stroke])], at(400, 402))?.id).toBe('stroke')
    expect(pickAnnotation([layer([stroke])], at(400, 460))).toBeNull()
  })

  it('never picks hidden layers, and skips locked layers for the eraser', () => {
    expect(pickAnnotation([layer([stroke], false, false)], at(400, 400))).toBeNull()
    expect(pickAnnotation([layer([stroke], true)], { ...at(400, 400), skipLocked: true })).toBeNull()
    expect(pickAnnotation([layer([stroke], true)], at(400, 400))?.id).toBe('stroke')
  })
})
