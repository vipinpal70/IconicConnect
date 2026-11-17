import type { MeshCategory, ModelPurpose } from './scan-archive'

/**
 * Which files of a case archive are shown when the viewer opens.
 *
 * Everything stays listed in the Layers panel; only the default differs. Hidden files are not even
 * decoded until the user switches them on, so these rules decide most of the time-to-first-view.
 *
 * Rules (derived from real 3Shape, iTero, Medit and exocad exports):
 * - Designed restorations (CAD folder, STL/PLY/OBJ in a design output) are always shown.
 * - 3Shape helper scans are hidden: AuxScanDir/ (scanner-internal copies), Misc/, bite and articulator
 *   scans. They overlap the real scans and roughly double what has to be drawn.
 * - Per jaw, only the best scan is shown: "MB …" (finished model) → plain → "Raw …" → "PrePreparation…".
 * - Bite / buccal pieces (TotalJaw*, bite) are hidden. In a case submission, printable model bases
 *   (*modelbase*) are hidden when the raw jaw scans are present.
 * - If the rules would hide everything, everything is shown.
 */

export interface VisibilityCandidate {
  name: string
  category: MeshCategory
}

type Jaw = 'upper' | 'lower'

const HELPER_FOLDERS = new Set(['auxscandir', 'misc'])
const BITE_NAME = /bite|totaljaw|articulator|buccal|occlusion/i
const MODEL_BASE_NAME = /modelbase|model[ _-]base/i

function pathParts(name: string) {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  return { base: parts[parts.length - 1] ?? name, folders: parts.slice(0, -1).map((p) => p.toLowerCase()) }
}

export function jawOf(name: string): Jaw | null {
  const { base, folders } = pathParts(name)
  if (folders.includes('upper')) return 'upper'
  if (folders.includes('lower')) return 'lower'
  if (/upper|maxill|oberkiefer/i.test(base)) return 'upper'
  if (/lower|mandib|unterkiefer/i.test(base)) return 'lower'
  return null
}

/** Lower is better: finished model scan, plain scan, raw scan, pre-preparation scan. */
function scanRank(base: string): number {
  if (/^mb[ _-]/i.test(base)) return 0
  if (/pre[ _-]?prep/i.test(base)) return 3
  if (/^raw[ _-]/i.test(base)) return 2
  return 1
}

function isHelperScan(name: string): boolean {
  const { base, folders } = pathParts(name)
  return folders.some((f) => HELPER_FOLDERS.has(f)) || BITE_NAME.test(base)
}

export function defaultVisibleFiles(entries: VisibilityCandidate[], purpose: ModelPurpose): Set<string> {
  const visible = new Set<string>()

  // Scans: hide helpers, then keep the best-ranked scan(s) per jaw
  const bestByJaw = new Map<Jaw, number>()
  const scans = entries.filter((e) => e.category === 'scan' && !isHelperScan(e.name))
  for (const scan of scans) {
    const jaw = jawOf(scan.name)
    if (!jaw) continue
    const rank = scanRank(pathParts(scan.name).base)
    bestByJaw.set(jaw, Math.min(bestByJaw.get(jaw) ?? Infinity, rank))
  }
  for (const scan of scans) {
    const jaw = jawOf(scan.name)
    if (!jaw || scanRank(pathParts(scan.name).base) === bestByJaw.get(jaw)) visible.add(scan.name)
  }

  for (const entry of entries) {
    if (entry.category === 'cad') visible.add(entry.name)
  }

  const meshes = entries.filter((e) => e.category === 'mesh')
  if (purpose === 'design-output') {
    for (const mesh of meshes) visible.add(mesh.name)
  } else {
    const shown = meshes.filter((m) => !BITE_NAME.test(pathParts(m.name).base))
    const hasJawScans = shown.some((m) => !MODEL_BASE_NAME.test(pathParts(m.name).base))
    for (const mesh of shown) {
      if (!hasJawScans || !MODEL_BASE_NAME.test(pathParts(mesh.name).base)) visible.add(mesh.name)
    }
  }

  // 'other' (library parts, loose DCMs) only reaches the viewer when nothing else exists
  if (visible.size === 0) for (const entry of entries) visible.add(entry.name)
  return visible
}
