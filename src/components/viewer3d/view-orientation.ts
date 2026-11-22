import { jawOf } from './scan-visibility'
import type { MeshCategory } from './scan-archive'

export type Axis3 = [number, number, number]

export interface OrientationInput {
  name: string
  category: MeshCategory
  /** [minX, minY, minZ, maxX, maxY, maxZ] */
  bbox: [number, number, number, number, number, number]
  triangleCount: number
}

const WORLD_AXES: Axis3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/**
 * Which world axis points "up" (towards the occlusal side) for this model.
 *
 * Scanners disagree: 3Shape and iTero export Y-up, Medit and most exocad/STL exports Z-up. A dental
 * arch is much flatter than it is wide or deep, so its thinnest bounding-box axis is the occlusal
 * axis. Each scan votes with its triangle count; designed restorations are ignored (single crowns are
 * not arch-shaped). When both jaws are present the sign is chosen so the upper jaw sits above the
 * lower one; otherwise the positive axis is used.
 *
 * Only the camera uses this. Geometry and saved annotation coordinates are never transformed.
 */
export function inferUpAxis(meshes: OrientationInput[]): Axis3 {
  const voters = meshes.filter((m) => m.category !== 'cad' && m.triangleCount > 0)
  const pool = voters.length > 0 ? voters : meshes
  if (pool.length === 0) return [0, 1, 0]

  const votes = [0, 0, 0]
  for (const mesh of pool) {
    const size = [mesh.bbox[3] - mesh.bbox[0], mesh.bbox[4] - mesh.bbox[1], mesh.bbox[5] - mesh.bbox[2]]
    const thinnest = size.indexOf(Math.min(...size))
    votes[thinnest] += Math.max(1, mesh.triangleCount)
  }
  const axis = votes.indexOf(Math.max(...votes))

  const centerOn = (jaw: 'upper' | 'lower') => {
    const jawMeshes = pool.filter((m) => jawOf(m.name) === jaw)
    if (jawMeshes.length === 0) return null
    let sum = 0
    for (const m of jawMeshes) sum += (m.bbox[axis] + m.bbox[axis + 3]) / 2
    return sum / jawMeshes.length
  }
  const upper = centerOn('upper')
  const lower = centerOn('lower')
  const sign = upper !== null && lower !== null && upper < lower ? -1 : 1

  return WORLD_AXES[axis].map((v) => (v === 0 ? 0 : v * sign)) as Axis3
}
