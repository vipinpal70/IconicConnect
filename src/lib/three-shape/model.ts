/**
 * The normalized 3Shape domain model.
 *
 * Persisted verbatim under `cases.subTypeData.threeShape` so a case can be
 * reconstructed and re-mapped **without reopening the package**. Every
 * interpreted field keeps its raw counterpart (spec §53–56, §60, §65;
 * xml-work-plan.md §3).
 */

/** Bumped per the policy in xml-work-plan.md §16.1. See `version.ts`. */
export { PARSER_VERSION } from './version'

/* ------------------------------------------------------------------ *
 * Data quality
 * ------------------------------------------------------------------ */

export type WarningCode =
  | 'TOOTH_NUMBER_CONFLICT' // Items text tooth ≠ ToothElement.ToothNumber → used ToothNumber
  | 'UNKNOWN_TOOTH_CLASS' // CacheToothTypeClass not in the normalisation map
  | 'UNKNOWN_SUBTYPE' // toothElementTypeID has no friendly resolution
  | 'MODEL_FILE_NOT_FOUND' // ModelFilename not present in the archive
  | 'SCAN_FILE_NOT_FOUND' // Scan.FileName referenced but absent
  | 'PATIENT_NAME_UNAVAILABLE' // both first & last empty
  | 'CATEGORY_AMBIGUOUS' // signals disagree; picked one, flagged
  | 'MODEL_REQUIRED_DEFAULTED' // commercial choice, not in the file (Q5 — default "no")
  | 'ARCH_INFERRED' // arch derived from tooth elements (appliances, dentures — Q6)
  | 'DENTURE_TYPE_UNKNOWN' // Full/Partial/Immediate/… not in the file → caseType1 blank (Q6)
  | 'SUBTYPE_UNMAPPED' // a derived sub-value has no matching CASE_HIERARCHY option
  | 'NO_ORDER_XML' // raw-scan package → raw-scan card
  | 'NO_MATERIALS_XML'
  | 'NO_SCAN_SETTINGS'
  | 'ENCRYPTED_ENTRIES' // .3ml skipped
  | 'ZIP64'
  | 'LARGE_XML'

export type ErrorCode =
  | 'XML_UNREADABLE' // not a zip / no DentalContainer / parse failure
  | 'MULTIPLE_ORDER_XML' // >1 candidate order XML, or >1 <TDM_Item_Order> (Q4 — Option A)
  | 'ORDER_XML_NAME_MISMATCH' // the sole order XML's basename ≠ the zip basename (Q4)
  | 'NESTED_ZIP' // the upload is a zip wrapping another zip — unwrap and re-upload
  | 'NO_ORDER_AND_NO_MESHES' // nothing usable in the package
  | 'INFLATE_LIMIT' // entry exceeded the 25 MB decompress ceiling

export interface DataQualityWarning {
  code: WarningCode
  message: string
  /** How the importer resolved the conflict (spec §63) — always present for conflicts. */
  resolution?: string
  /** `subTypeData`-relative path so the carousel can highlight the field. */
  field?: string
}

export interface DataQualityError {
  code: ErrorCode
  message: string
}

export interface DataQuality {
  valid: boolean
  requiresReview: boolean
  warnings: DataQualityWarning[]
  errors: DataQualityError[]
}

/**
 * Warning codes that, when present, force `requiresReview = true` (the carousel
 * shows an amber "check this" state). `TOOTH_NUMBER_CONFLICT` is deliberately
 * NOT here — its resolution is deterministic (always trust `ToothNumber`), so
 * it is informational, shown in the "from the package" panel only.
 */
export const REVIEW_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'UNKNOWN_TOOTH_CLASS',
  'CATEGORY_AMBIGUOUS',
  'MODEL_REQUIRED_DEFAULTED',
  'ARCH_INFERRED',
  'DENTURE_TYPE_UNKNOWN',
  'SUBTYPE_UNMAPPED',
])

/* ------------------------------------------------------------------ *
 * Leaf structures
 * ------------------------------------------------------------------ */

export interface Component {
  /** "Crown" | "Abutment" | "Crown Pontic" | "Artificial Teeth" | "Gingiva" | … */
  type: string
  modelElementId: string | null
  toothNumbers: number[] // UNN
  subtypeIds: string[]
  material: { id: string | null; name: string | null } | null
}

export interface ToothElement {
  toothElementId: string
  modelElementId: string | null
  /** UNN — AUTHORITATIVE tooth selection. Never read from Items / filenames. */
  toothNumber: number | null
  fdi: number | null // derived, for display only
  arch: 'Upper' | 'Lower' | null
  rawClass: string // CacheToothTypeClass, verbatim
  normalizedClass: string // mapped; "Unknown" + requiresReview if unmapped
  rawSubtypeId: string | null // toothElementTypeID, verbatim, unsplit
  anatomical: boolean
  postAndCore: boolean
  abutmentKitId: string | null
}

export interface ModelElement {
  modelElementId: string
  modelJobId: string | null
  materialId: string | null
  materialName: string | null
  rawMaterialName: string | null
  colorId: string | null
  colorName: string | null
  rawColor: string | null
  manufacturingProcessId: string | null
  camProcessId: string | null
  camProcessName: string | null
  manufacturerId: string | null
  manufacturerName: string | null
  modelElementType: string | null // meIndicationRegular / meSplint …
  validationResult: string | null // vrPassed / vrFailed
  validationPassed: boolean | null // normalized
  processStatusId: string | null
  altProcessStatusId: string | null
  processLockId: string | null
  modelFilename: string | null // CAD/model INPUT path — NOT the app outputFile
  resolvedAssetPath: string | null // matched archive entry, or null → MODEL_FILE_NOT_FOUND
  geometry: {
    height: number | null
    volume: number | null
    boundingBox: { min: number[]; max: number[] } | null
  }
  virtualItem: boolean
  comment: string | null
  items: string | null // ModelElement.Items — context only
  dates: {
    create: string | null
    delivery: string | null
    shipping: string | null
    receive: string | null
  }
}

export interface ModelJob {
  modelJobId: string
  orderId: string | null
}

export interface Link {
  linkId: string
  linkTypeId: string | null
  cacheLinkTypeClass: string | null
  modelElementId: string | null
}

export interface LinkToothElement {
  linkToothElementId: string
  linkId: string
  toothElementId: string
}

export interface Scan {
  scanId: string
  rawScanType: string
  normalizedScanType: string
  modelJobId: string | null
  modelElementId: string | null
  toothElementId: string | null
  scanDate: string | null
  scanName: string | null
  fileNameInXml: string | null // often empty
  resolvedAssetPath: string | null // discovered by scanning Scans/** in the archive
}

export interface Attachment {
  attachmentId: string | null
  type: string | null
  fileName: string | null
  path: string | null
  resolvedAssetPath: string | null
}

export type AssetKind =
  | 'CAD'
  | 'SCAN'
  | 'SCREENSHOT'
  | 'ANATOMY'
  | 'EXTERNAL_MODEL'
  | 'ORDER_SOURCE'
  | 'MATERIAL_DEFINITION'
  | 'MANUFACTURER_DEFINITION'
  | 'DESIGN_TREE'
  | 'OTHER'

export interface Asset {
  path: string // exact archive-relative path
  sizeBytes: number
  kind: AssetKind
  encrypted: boolean // 3Shape .3ml archives are password-protected
}

export interface CustomDatum {
  customDataId: string | null
  fieldId: string | null
  fieldCaption: string | null
  value: string | null
  kind: 'public' | 'internal' | string
}

/* ------------------------------------------------------------------ *
 * The case
 * ------------------------------------------------------------------ */

export interface ThreeShapeCase {
  source: {
    system: '3shape'
    containerVersion: string | null // DentalContainer @version, e.g. "2022-1"
    parserVersion: string // semver; bump policy in xml-work-plan.md §16.1
    packageName: string // the uploaded zip file name
    extractedAt: string // ISO
  }

  sourceIds: {
    sourceOrderId: string | null // IntOrderID — NOT the app caseNumber
    numericOrderId: string | null // NumOrderID
    externalOrderId: string | null // ExtOrderID
    importOrderId: string | null // ImportOrderID
    originalOrderId: string | null // OriginalOrderID
    clientOrderNo: string | null
    sourceClientId: string | null // 3Shape ClientID — NOT a UUID
  }

  patient: {
    refNo: string | null
    firstName: string | null
    lastName: string | null
    fullName: string | null // joined; lastName may already hold the full name
    guid: string | null
  }

  order: {
    customer: string | null
    manufacturerName: string | null
    erpCustomerNo: string | null
    contactPerson: string | null
    comments: string | null // OrderComments (verbatim) → cases.clientMassage
    importance: string | null
    operatorId: string | null
    operatorName: string | null // NEVER auto-mapped to designerId / createdBy
    source: {
      createdFromApp: string | null
      designModule: string | null
      modelDesignModule: string | null
      scanModule: string | null
      faceScanModule: string | null
      scanSource: string | null
      modelManufacturingId: string | null
    }
    rawItems: string | null // OrderList.Items — CONTEXT ONLY, never authoritative
  }

  classification: {
    category: string // normalized, app taxonomy or "Unknown"
    scriptCategory: string // pre-normalisation ("Crown & Bridge", "3D Model" …)
    rawToothClasses: string[] // every CacheToothTypeClass seen, de-duped
    normalizedClasses: string[] // Crown / Abutment / Splint / Coping / Bridge / Gingiva …
    subtypeIds: string[] // every toothElementTypeID, verbatim (do NOT split)
    toothNumbers: number[] // UNN, authoritative, sorted, de-duped
    isMultiComponent: boolean
    components: Component[]
  }

  modelJobs: ModelJob[]
  modelElements: ModelElement[]
  toothElements: ToothElement[]
  relationships: {
    links: Link[]
    linkToothElements: LinkToothElement[]
    splitBridgeLinks: unknown[] // preserved raw if present
    connectorSpans: number[][] // union-find over ltConnector links → [[12,13,14], …]
  }

  scans: Scan[]
  attachments: Attachment[]
  assets: Asset[]
  customData: CustomDatum[]

  sourceStatus: {
    processStatusId: string | null // psModelled …
    altProcessStatusId: string | null
    processLockId: string | null // plReady …
    validationResult: string | null // vrPassed / vrFailed (order/model level summary)
  }

  timestamps: {
    createDate: string | null
    deliveryDate: string | null // REQUESTED date — not proof of delivery
    shippingDate: string | null
    receiveDate: string | null
    maxScanDate: string | null
  }

  dataQuality: DataQuality
}
