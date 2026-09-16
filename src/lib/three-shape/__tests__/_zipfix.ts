/** Build a minimal, valid ZIP in memory for tests — stored or deflate entries. */
import zlib, { deflateRawSync } from 'node:zlib'

function crc32(buf: Buffer): number {
  // Node 22 ships zlib.crc32; fall back to a table impl otherwise.
  const z = zlib as unknown as { crc32?: (b: Buffer) => number }
  if (typeof z.crc32 === 'function') return z.crc32(buf) >>> 0
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

export interface ZipFixEntry {
  name: string
  data: Buffer | string
  /** 'store' (method 0) or 'deflate' (method 8). Default 'deflate'. */
  method?: 'store' | 'deflate'
}

export function makeZip(entries: ZipFixEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const method = e.method === 'store' ? 0 : 8
    const comp = method === 0 ? raw : deflateRawSync(raw)
    const crc = crc32(raw)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    local.push(lh, nameBuf, comp)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)

    offset += lh.length + nameBuf.length + comp.length
  }

  const localBuf = Buffer.concat(local)
  const centralBuf = Buffer.concat(central)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(localBuf.length, 16)

  return Buffer.concat([localBuf, centralBuf, eocd])
}

/* ------------------------------------------------------------------ *
 * Synthetic 3Shape DentalContainer XML
 * ------------------------------------------------------------------ */

export interface FixtureTooth {
  unn: number
  cls: string // CacheToothTypeClass, e.g. "teCrown"
  typeId?: string
  material?: string
  abutmentKitId?: string
}

export interface FixtureOrderOpts {
  intOrderId?: string
  items?: string
  comments?: string
  clientId?: string
  designModule?: string
  /** UNN pairs joined by an `ltConnector` link (bridge). */
  connectors?: Array<[number, number]>
  /** Emit N `<TDM_Item_Order>` records instead of 1 (Q4 negative test). */
  orderRecords?: number
}

function prop(name: string, value: string | number): string {
  const v = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<Property name="${name}" value="${v}"/>`
}

function tdmList(name: string, type: string, items: string[]): string {
  return `<Object name="${name}" type="TDM_List_${type}"><List name="Items">${items.join('')}</List></Object>`
}

/** Build a minimal but valid DentalContainer order XML. */
export function buildOrderXml(teeth: FixtureTooth[], opts: FixtureOrderOpts = {}): string {
  const meId = 'ME1'
  const orderItem = [
    prop('IntOrderID', opts.intOrderId ?? 'FIX_1'),
    prop('NumOrderID', '123456'),
    prop('ClientID', opts.clientId ?? '17929'),
    prop('Items', opts.items ?? ''),
    prop('OrderComments', opts.comments ?? ''),
    prop('Customer', 'FIXTURE LAB'),
    prop('ManufName', 'FIXTURE LAB'),
    prop('DesignModuleID', opts.designModule ?? 'DentalDesigner'),
    prop('CacheMaxScanDate', '1788525019'),
  ].join('')
  const orderRecords = Array.from(
    { length: opts.orderRecords ?? 1 },
    () => `<Object type="TDM_Item_Order">${orderItem}</Object>`,
  ).join('')

  const toothItems = teeth.map((t, i) => {
    const teId = `TE${i + 1}`
    return `<Object type="TDM_Item_ToothElement">${[
      prop('ToothElementID', teId),
      prop('ModelElementID', meId),
      prop('toothElementTypeID', t.typeId ?? `${t.cls}_type`),
      prop('ToothNumber', t.unn),
      prop('CacheToothTypeClass', t.cls),
      prop('Anatomical', 'False'),
      prop('PostAndCore', 'False'),
      ...(t.abutmentKitId ? [prop('AbutmentKitID', t.abutmentKitId)] : []),
    ].join('')}</Object>`
  })

  const modelEl = `<Object type="TDM_Item_ModelElement">${[
    prop('ModelElementID', meId),
    prop('ModelJobID', 'MJ1'),
    prop('ModelElementType', 'meIndicationRegular'),
    prop('CacheMaterialName', teeth[0]?.material ?? 'Zirkon'),
    prop('MaterialID', 'MAT1'),
    prop('ValidationResult', 'vrPassed'),
    prop('ProcessStatusID', 'psModelled'),
    prop('CreateDate', '1788500000'),
    prop('DeliveryDate', '1788600000'),
  ].join('')}</Object>`

  const links: string[] = []
  const linkTooth: string[] = []
  ;(opts.connectors ?? []).forEach(([a, b], i) => {
    const linkId = `L${i + 1}`
    links.push(
      `<Object type="TDM_Item_Link">${[
        prop('LinkID', linkId),
        prop('LinkTypeID', 'LinkTypeConnector6'),
        prop('CacheLinkTypeClass', 'ltConnector'),
        prop('ModelElementID', meId),
      ].join('')}</Object>`,
    )
    const teA = `TE${teeth.findIndex((t) => t.unn === a) + 1}`
    const teB = `TE${teeth.findIndex((t) => t.unn === b) + 1}`
    linkTooth.push(
      `<Object type="TDM_Item_LinkToothElement">${[prop('LinkToothElementID', `LT${i}a`), prop('LinkID', linkId), prop('ToothElementID', teA)].join('')}</Object>`,
      `<Object type="TDM_Item_LinkToothElement">${[prop('LinkToothElementID', `LT${i}b`), prop('LinkID', linkId), prop('ToothElementID', teB)].join('')}</Object>`,
    )
  })

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<DentalContainer version="2022-1"><Object name="MainObject" type="TDM_Container">` +
    tdmList('OrderList', 'Order', [orderRecords]) +
    tdmList('ModelJobList', 'ModelJob', [`<Object type="TDM_Item_ModelJob">${prop('ModelJobID', 'MJ1')}${prop('OrderID', 'FIX_1')}</Object>`]) +
    tdmList('ModelElementList', 'ModelElement', [modelEl]) +
    tdmList('ToothElementList', 'ToothElement', toothItems) +
    tdmList('LinkList', 'Link', links) +
    tdmList('LinkToothElementList', 'LinkToothElement', linkTooth) +
    tdmList('ScanList', 'Scan', [`<Object type="TDM_Item_Scan">${prop('ScanID', 'S1')}${prop('ScanType', 'stPreperation')}${prop('ModelJobID', 'MJ1')}${prop('FileName', '')}</Object>`]) +
    `</Object></DentalContainer>`
  )
}

/** A tracking `RangeReader` over a buffer that records every byte range read. */
export function trackingReader(buf: Buffer) {
  const reads: Array<{ offset: number; length: number }> = []
  return {
    reads,
    reader: {
      size: async () => buf.length,
      read: async (offset: number, length: number) => {
        reads.push({ offset, length })
        return buf.subarray(offset, offset + length)
      },
    },
    /** Total bytes handed out across all reads. */
    bytesRead: () => reads.reduce((n, r) => n + r.length, 0),
  }
}
