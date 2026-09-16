/**
 * Package orchestrator — one uploaded `.zip` → one extraction result.
 *
 * Q4 (xml-work-plan.md §20 / §5.2a): **one 3Shape case per zip.** A zip with
 * more than one real order XML, or an order XML with more than one
 * `<TDM_Item_Order>`, is a user error — we return an error, never silently pick
 * one order.
 */
import { classifyAssets } from './assets'
import { assembleThreeShapeCase } from './assemble'
import { countOrderRecords, parseOrder, parseScanSettings } from './dental-order'
import { mapOrderToDraft, type MappedDraft } from './map-to-case'
import type { ErrorCode, ThreeShapeCase } from './model'
import { hasMeshAssets, rawScanDraft, rawScanThreeShapeCase } from './raw-scan'
import { openZip, readZipEntry, ZipError, type RangeReader, type ZipEntry } from './zip'

/**
 * Order XML entries above this are ignored (guards a pathological archive). Real
 * DentalContainer order files are typically 0.1–2 MB — mostly-empty 90-list
 * graphs — so 15 MB is generous headroom.
 */
const MAX_ORDER_XML_BYTES = 15 * 1024 * 1024
/** Inflate ceiling for reading an order XML specifically (vs the 25 MB default). */
const ORDER_XML_INFLATE_LIMIT = 20 * 1024 * 1024
/** More candidate XMLs than this ⇒ obviously a hand-bundled folder. */
const MAX_XML_CANDIDATES = 8

export type ExtractResult =
  | {
      ok: true
      packageName: string
      /** `null` ⇒ raw-scan package; the carousel opens a blank form. */
      draft: MappedDraft
      threeShape: ThreeShapeCase
    }
  | {
      ok: false
      packageName: string
      error: { code: ErrorCode; message: string }
    }

function isCompanion(name: string): boolean {
  const b = (name.split(/[\\/]/).pop() ?? name).toLowerCase()
  return b === 'materials.xml' || b === 'sid_userinputdata.xml'
}

/** Extract one package. Never throws — failures come back as `{ ok:false }`. */
export async function extractPackage(
  reader: RangeReader,
  packageName: string,
): Promise<ExtractResult> {
  let entries: ZipEntry[]
  try {
    const zip = await openZip(reader)
    entries = zip.entries
  } catch (err) {
    return fail(packageName, 'XML_UNREADABLE', err instanceof ZipError ? err.message : 'Not a readable ZIP archive')
  }

  const assets = classifyAssets(entries)

  const xmlCandidates = entries.filter(
    (e) =>
      !e.name.endsWith('/') &&
      !e.encrypted &&
      e.name.toLowerCase().endsWith('.xml') &&
      e.size > 0 &&
      e.size < MAX_ORDER_XML_BYTES &&
      !isCompanion(e.name),
  )

  if (xmlCandidates.length > MAX_XML_CANDIDATES) {
    return fail(
      packageName,
      'MULTIPLE_ORDER_XML',
      `This file contains ${xmlCandidates.length} XML files — upload each 3Shape case as its own zip.`,
    )
  }

  // Inflate each candidate and keep only real DentalContainer order files.
  const orderXmls: Array<{ entry: ZipEntry; text: string }> = []
  for (const entry of xmlCandidates) {
    let text: string
    try {
      const buf = await readEntry(reader, entries, entry.name, ORDER_XML_INFLATE_LIMIT)
      text = buf.toString('utf8')
    } catch {
      continue
    }
    if (/<DentalContainer/i.test(text) && /TDM_Item_Order/.test(text)) {
      orderXmls.push({ entry, text })
    }
  }

  if (orderXmls.length === 0) {
    // A zip whose only real payload is another zip — labs sometimes double-zip.
    // Flag it clearly rather than showing a misleading "no data" raw-scan card.
    const nested = entries.find(
      (e) => !e.name.endsWith('/') && e.name.toLowerCase().endsWith('.zip'),
    )
    if (nested) {
      return fail(
        packageName,
        'NESTED_ZIP',
        `This file has another zip inside it ("${nested.name.split(/[\\/]/).pop()}"). Open that zip and upload the 3Shape export directly.`,
      )
    }
    if (hasMeshAssets(assets)) {
      return {
        ok: true,
        packageName,
        draft: rawScanDraft(),
        threeShape: rawScanThreeShapeCase(packageName, assets),
      }
    }
    return fail(
      packageName,
      'NO_ORDER_AND_NO_MESHES',
      'No 3Shape order file and no scan meshes were found in this package.',
    )
  }

  if (orderXmls.length > 1) {
    return fail(
      packageName,
      'MULTIPLE_ORDER_XML',
      'This file contains more than one 3Shape case — upload each case as its own zip.',
    )
  }

  const orderXml = orderXmls[0].text

  const orderCount = countOrderRecords(orderXml)
  if (orderCount === 0) {
    return fail(packageName, 'XML_UNREADABLE', 'The 3Shape XML has no order record.')
  }
  if (orderCount > 1) {
    return fail(
      packageName,
      'MULTIPLE_ORDER_XML',
      `The 3Shape XML holds ${orderCount} orders — upload each case as its own zip.`,
    )
  }

  // Companions.
  const materialsXml = await tryReadByBasename(reader, entries, 'materials.xml')
  const sidXml = await tryReadByBasename(reader, entries, 'sid_userinputdata.xml')

  let parsed
  try {
    parsed = parseOrder(orderXml, materialsXml)
  } catch (err) {
    return fail(packageName, 'XML_UNREADABLE', err instanceof Error ? err.message : 'Failed to parse the 3Shape XML')
  }

  const scanSettings = parseScanSettings(sidXml)
  const mapped = mapOrderToDraft(parsed, scanSettings)
  const threeShape = assembleThreeShapeCase({
    packageName,
    parsed,
    scanSettings,
    assets,
    hadMaterialsXml: Boolean(materialsXml),
    mapped,
  })

  return { ok: true, packageName, draft: mapped, threeShape }
}

/* ------------------------------------------------------------------ */

function fail(packageName: string, code: ErrorCode, message: string): ExtractResult {
  return { ok: false, packageName, error: { code, message } }
}

async function readEntry(
  reader: RangeReader,
  entries: ZipEntry[],
  name: string,
  maxInflateBytes?: number,
): Promise<Buffer> {
  const entry = entries.find((e) => e.name === name)
  if (!entry) throw new Error(`entry ${name} not found`)
  return readZipEntry(reader, entry, maxInflateBytes)
}

async function tryReadByBasename(
  reader: RangeReader,
  entries: ZipEntry[],
  basenameLc: string,
): Promise<string | null> {
  const entry = entries.find(
    (e) => (e.name.split(/[\\/]/).pop() ?? e.name).toLowerCase() === basenameLc && !e.encrypted,
  )
  if (!entry) return null
  try {
    const buf = await readZipEntry(reader, entry)
    return buf.toString('utf8')
  } catch {
    return null
  }
}
