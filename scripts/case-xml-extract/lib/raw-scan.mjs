/**
 * The second input format: a plain scan bundle with no order XML.
 *
 * Some labs upload straight out of the scanner — a folder of STL/PLY/DCM
 * meshes and nothing else (`CN30555.zip` is the reference sample: three STLs
 * under `Stage 1/`, plus a stray `Thumbs.db`). There is no DentalContainer,
 * so there is no indication, no tooth number, no material, no comments.
 *
 * Almost nothing about the case can be derived from these. This module exists
 * so the tool says exactly that, with an inventory of what *is* there, instead
 * of failing with "no order XML found".
 */

const MESH_EXT = /\.(stl|ply|obj|dcm|off)$/i
const JUNK = /(^|\/)(thumbs\.db|\.ds_store|desktop\.ini)$/i

/** Filename conventions 3Shape and the common portals use for each scan. */
const SCAN_ROLES = [
  [/upper.*(jaw|scan|arch)|(^|\W)upper(\W|$)|maxilla/i, 'Upper jaw'],
  [/lower.*(jaw|scan|arch)|(^|\W)lower(\W|$)|mandib/i, 'Lower jaw'],
  [/bite|occlus|buccal/i, 'Bite registration'],
  [/prep(aration)?/i, 'Preparation'],
  [/antagon/i, 'Antagonist'],
  [/pre[-_ ]?op|prelim/i, 'Pre-operative / preliminary'],
  [/gingiv|tissue/i, 'Gingiva mask'],
  [/emergence/i, 'Emergence profile'],
  [/model|die/i, 'Model / die'],
]

const roleOf = (name) => SCAN_ROLES.find(([re]) => re.test(name))?.[1] ?? null

/** Binary STL: 80-byte header (often the exporting app) + uint32 triangle count. */
function readStlHeader(buf) {
  if (!buf || buf.length < 84) return null
  const header = buf.subarray(0, 80).toString('latin1').replace(/\0/g, '').trim()
  if (/^solid/i.test(header) && !/\d/.test(header.slice(0, 6))) return { creator: header, triangles: null }
  return { creator: header || null, triangles: buf.readUInt32LE(80) }
}

/**
 * @param {{name: string, size: number, readHead?: () => Buffer|null, mtime?: Date|null}[]} entries
 * @param {string} id  bundle name (usually the case reference)
 */
export function describeRawScan(entries, id) {
  const files = entries.filter((e) => !JUNK.test(e.name) && !e.name.endsWith('/'))
  const meshes = files.filter((e) => MESH_EXT.test(e.name))

  // Portals commonly nest the scans under a "Stage N" folder for multi-visit work.
  const stages = [...new Set(
    files.map((e) => /(^|\/)stage[\s_-]*(\d+)/i.exec(e.name)?.[2]).filter(Boolean)
  )].sort()

  const scans = meshes.map((e) => {
    const base = e.name.split('/').pop()
    const stl = MESH_EXT.test(base) && /\.stl$/i.test(base) ? readStlHeader(e.readHead?.()) : null
    return {
      file: base,
      path: e.name,
      role: roleOf(base),
      sizeBytes: e.size,
      triangles: stl?.triangles ?? null,
      creator: stl?.creator ?? null,
      modified: e.mtime ? e.mtime.toISOString() : null,
    }
  })

  const roles = new Set(scans.map((s) => s.role).filter(Boolean))
  const arches = []
  if (roles.has('Upper jaw')) arches.push('Upper')
  if (roles.has('Lower jaw')) arches.push('Lower')

  return {
    id,
    kind: 'raw-scan',
    stages,
    arches,
    hasBite: roles.has('Bite registration'),
    scans,
    otherFiles: files.filter((e) => !MESH_EXT.test(e.name)).map((e) => e.name),
    skipped: entries.filter((e) => JUNK.test(e.name)).map((e) => e.name),
    creators: [...new Set(scans.map((s) => s.creator).filter(Boolean))],
    totalBytes: files.reduce((n, e) => n + e.size, 0),
  }
}

/**
 * The case payload for a bundle like this is a skeleton: every field a human
 * must supply, because the scan meshes carry none of it.
 */
export function rawScanToCase(desc, options = {}) {
  const arch = desc.arches.length === 2 ? 'Both Arches' : desc.arches[0] ?? null
  const notes = [
    '--- Imported from a raw scan upload (no order file) ---',
    `Source bundle: ${desc.id}`,
    desc.stages.length ? `Stage: ${desc.stages.join(', ')}` : null,
    `Scans: ${desc.scans.map((s) => s.role ?? s.file).join(', ')}`,
    arch ? `Arches scanned: ${arch}` : null,
    desc.hasBite ? 'Bite registration included' : 'No bite registration found',
    desc.creators.length ? `Exported by: ${desc.creators.join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const manual = (value, why) => ({ value, source: why, confidence: 'manual' })
  const provenance = {
    category: manual(options.category ?? null, 'a raw scan bundle carries no indication — a human must choose the category'),
    'subTypeData.teeth': manual([], 'no tooth numbers exist anywhere in a mesh-only upload'),
    'subTypeData.modelRequired': manual(options.modelRequired ?? 'no', 'a client choice, not in the upload'),
    clientId: manual(options.clientId ?? null, 'not in the upload — identify the lab from the portal submission'),
    serviceType: manual(options.serviceType ?? 'design_only', 'commercial choice, not in the upload'),
  }

  return {
    casePayload: {
      clientId: options.clientId ?? null,
      serviceType: options.serviceType ?? 'design_only',
      category: options.category ?? null,
      subTypeData: {
        teeth: [],
        toothSystem: 'USA',
        modelRequired: options.modelRequired ?? 'no',
        notes,
        ...(arch ? { arch } : {}),
      },
      caseNumber: null,
      uploadedFile: null,
      uploadedFiles: [],
      preferredTeethLibrary: options.preferredTeethLibrary ?? 'default',
      teethLibraryFileUrl: null,
      teethLibraryFileName: null,
    },
    provenance,
    needsReview: Object.entries(provenance).map(([field, p]) => ({
      field, value: p.value, why: p.source, confidence: p.confidence,
    })),
    unmapped: {
      sourceBundle: desc.id,
      stages: desc.stages,
      archesScanned: desc.arches,
      biteRegistration: desc.hasBite,
      meshCount: desc.scans.length,
      totalBytes: desc.totalBytes,
      exportedBy: desc.creators,
    },
  }
}
