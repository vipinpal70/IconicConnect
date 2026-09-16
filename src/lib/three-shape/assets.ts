/**
 * Classify every archive entry into a typed inventory (`Asset[]`).
 *
 * xml-work-plan.md §5.3 / spec §42. Screenshots are NEVER treated as clinical
 * scans. Paths are only ever matched, never used as filesystem paths.
 */
import type { Asset, AssetKind } from './model'
import type { ZipEntry } from './zip'

/** Last path segment, lowercased. */
function base(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).toLowerCase()
}

/** Extensions that are always a scan/CAD mesh, wherever they sit in the archive. */
const MESH_EXT = /\.(stl|ply|obj|dcm|off|3mf|nxa|xyz)$/i

function classify(path: string): AssetKind {
  const p = path.replace(/\\/g, '/').toLowerCase()
  const b = base(path)

  if (b === 'materials.xml' || /^materialsintegrity_.*\.3ml$/.test(b)) return 'MATERIAL_DEFINITION'
  if (b === 'manufacturers.3ml') return 'MANUFACTURER_DEFINITION'
  if (b === 'dentaldesignermodellingtree.3ml' || b === 'dentaldesigneroutput.3ml') return 'DESIGN_TREE'

  if (p.includes('3scom/screenshots/') || p.includes('/screenshots/')) return 'SCREENSHOT'
  if (p.startsWith('anatomy elements/') || p.includes('/anatomy elements/')) return 'ANATOMY'
  if (p.startsWith('external models/') || p.includes('/external models/')) return 'EXTERNAL_MODEL'
  if (p.startsWith('cad/') || p.includes('/cad/')) return 'CAD'
  if (p.startsWith('scans/') || p.includes('/scans/')) return 'SCAN'
  if (p.startsWith('ordersource/') || p.includes('/ordersource/') || b.endsWith('.3oxz')) return 'ORDER_SOURCE'

  // A loose scan mesh with no telling folder (e.g. CN30555.zip → three root STLs).
  if (MESH_EXT.test(b)) return 'SCAN'

  return 'OTHER'
}

/** Build the `assets[]` inventory from the ZIP central directory. */
export function classifyAssets(entries: ZipEntry[]): Asset[] {
  return entries
    .filter((e) => !e.name.endsWith('/'))
    .map((e) => ({
      path: e.name,
      sizeBytes: e.size,
      kind: classify(e.name),
      encrypted: e.encrypted,
    }))
}

/**
 * Resolve an XML-referenced path (a `ModelFilename` or a `Scan.FileName`) to an
 * actual archive entry. Matches on basename, case-insensitively, since the XML
 * uses `CAD\foo.dcm` style paths that rarely match the zip layout exactly.
 */
export function resolveAsset(assets: Asset[], referenced: string | null | undefined): string | null {
  if (!referenced) return null
  const want = base(referenced)
  const hit = assets.find((a) => base(a.path) === want)
  return hit?.path ?? null
}

/** All SCAN-kind asset paths — used to attach scans the XML left unnamed. */
export function scanAssetPaths(assets: Asset[]): string[] {
  return assets.filter((a) => a.kind === 'SCAN').map((a) => a.path)
}
