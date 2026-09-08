/**
 * Assemble the full {@link ThreeShapeCase} domain model from a `ParsedOrder`
 * (+ optional scan settings + archive asset inventory).
 *
 * This is the lossless "source representation" persisted under
 * `cases.subTypeData.threeShape` (spec §33, §53–56, §65). Every interpreted
 * field keeps its raw counterpart; nothing is dropped.
 */
import { resolveAsset, scanAssetPaths } from './assets'
import {
  archOf,
  UNN_TO_FDI,
  unixToIso,
  SCAN_TYPES,
  TOOTH_CLASSES,
  type ParsedOrder,
  type ScanSettings,
  type TdmRecord,
} from './dental-order'
import type { MappedDraft } from './map-to-case'
import {
  PARSER_VERSION,
  REVIEW_CODES,
  type Asset,
  type Component,
  type DataQuality,
  type DataQualityWarning,
  type ModelElement,
  type Scan,
  type ThreeShapeCase,
  type ToothElement,
} from './model'

const nn = (v: string | undefined | null): string | null => (v ? v : null)
const num = (v: string | undefined | null): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const bool = (v: string | undefined | null): boolean => v === 'True' || v === 'true'

/** Human component label for a tooth class. */
const COMPONENT_LABELS: Record<string, string> = {
  teArtificialTooth: 'Artificial Teeth',
  teGingivaFD: 'Gingiva',
  teCrownPontic: 'Crown Pontic',
  teCoping: 'Coping',
  teCopingPontic: 'Coping Pontic',
  teAbutment: 'Abutment',
  teAbutmentPontic: 'Abutment Pontic',
  teScrewRetained: 'Screw-Retained Crown',
  teCrownScrewRetained: 'Screw-Retained Crown',
}
function componentType(rawClass: string): string {
  return COMPONENT_LABELS[rawClass] ?? TOOTH_CLASSES[rawClass]?.label ?? rawClass ?? 'Unknown'
}

function buildToothElements(parsed: ParsedOrder): ToothElement[] {
  const unitByTe = new Map(parsed.units.map((u) => [u.toothElementId, u]))
  return parsed.raw.toothElements.map((te) => {
    const unit = unitByTe.get(te.ToothElementID)
    const unn = num(te.ToothNumber)
    const known = TOOTH_CLASSES[te.CacheToothTypeClass || '']
    return {
      toothElementId: te.ToothElementID,
      modelElementId: nn(te.ModelElementID),
      toothNumber: unn,
      fdi: unn != null ? UNN_TO_FDI[unn] ?? null : null,
      arch: unn != null ? archOf(unn) : null,
      rawClass: te.CacheToothTypeClass || '',
      normalizedClass: known?.label ?? (unit?.indication || 'Unknown'),
      rawSubtypeId: nn(te.toothElementTypeID),
      anatomical: bool(te.Anatomical),
      postAndCore: bool(te.PostAndCore),
      abutmentKitId: nn(te.AbutmentKitID),
    }
  })
}

function buildModelElements(parsed: ParsedOrder, assets: Asset[]): ModelElement[] {
  const { materials, colors } = parsed.lookups
  return parsed.raw.modelElements.map((m: TdmRecord) => {
    const validationResult = nn(m.ValidationResult)
    const min = [m.ModelBoundingBoxMin, m.BoundingBoxMin].find(Boolean)
    const max = [m.ModelBoundingBoxMax, m.BoundingBoxMax].find(Boolean)
    const parseVec = (s: string | undefined) =>
      s ? s.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n)) : []
    return {
      modelElementId: m.ModelElementID,
      modelJobId: nn(m.ModelJobID),
      materialId: nn(m.MaterialID),
      materialName: (m.MaterialID ? materials.get(m.MaterialID)?.Name : null) ?? nn(m.CacheMaterialName),
      rawMaterialName: nn(m.CacheMaterialName),
      colorId: nn(m.ColorID),
      colorName: (m.ColorID ? colors.get(m.ColorID)?.Name : null) ?? nn(m.CacheColor),
      rawColor: nn(m.CacheColor),
      manufacturingProcessId: nn(m.ManufacturingProcessID),
      camProcessId: nn(m.CAMProcessID),
      camProcessName: nn(m.CAMProcessName),
      manufacturerId: nn(m.ManufacturerID),
      manufacturerName: nn(m.ManufName),
      modelElementType: nn(m.ModelElementType),
      validationResult,
      validationPassed:
        validationResult == null ? null : /pass/i.test(validationResult),
      processStatusId: nn(m.ProcessStatusID),
      altProcessStatusId: nn(m.AltProcessStatusID),
      processLockId: nn(m.ProcessLockID),
      modelFilename: nn(m.ModelFilename),
      resolvedAssetPath: resolveAsset(assets, m.ModelFilename),
      geometry: {
        height: num(m.ModelHeight),
        volume: num(m.ModelVolume),
        boundingBox: min || max ? { min: parseVec(min), max: parseVec(max) } : null,
      },
      virtualItem: bool(m.VirtualItem),
      comment: nn(m.ModelComment),
      items: nn(m.Items),
      dates: {
        create: unixToIso(m.CreateDate),
        delivery: unixToIso(m.DeliveryDate),
        shipping: unixToIso(m.ShippingDate),
        receive: unixToIso(m.ReceiveDate),
      },
    }
  })
}

function buildScans(parsed: ParsedOrder, assets: Asset[]): Scan[] {
  const scanPaths = scanAssetPaths(assets)
  let unnamedIdx = 0
  return parsed.raw.scans.map((s) => {
    const rawScanType = s.ScanType || ''
    const named = resolveAsset(assets, s.FileName)
    // XML often leaves FileName empty — fall back to the discovered Scans/** list.
    const resolved = named ?? scanPaths[unnamedIdx++] ?? null
    return {
      scanId: s.ScanID,
      rawScanType,
      normalizedScanType: SCAN_TYPES[rawScanType] ?? rawScanType,
      modelJobId: nn(s.ModelJobID),
      modelElementId: s.ModelElementID && s.ModelElementID !== '_NULL_' ? s.ModelElementID : null,
      toothElementId: s.ToothElementID && s.ToothElementID !== '_NULL_' ? s.ToothElementID : null,
      scanDate: unixToIso(s.ScanDate),
      scanName: nn(s.ScanName),
      fileNameInXml: nn(s.FileName),
      resolvedAssetPath: resolved,
    }
  })
}

function buildComponents(parsed: ParsedOrder): Component[] {
  const byType = new Map<string, Component>()
  for (const u of parsed.units) {
    const type = componentType(u.toothClass)
    let comp = byType.get(type)
    if (!comp) {
      comp = { type, modelElementId: u.modelElementId || null, toothNumbers: [], subtypeIds: [], material: null }
      byType.set(type, comp)
    }
    if (u.unn && !comp.toothNumbers.includes(u.unn)) comp.toothNumbers.push(u.unn)
    if (u.indicationTypeId && !comp.subtypeIds.includes(u.indicationTypeId)) {
      comp.subtypeIds.push(u.indicationTypeId)
    }
    if (!comp.material && (u.materialId || u.materialName || u.material)) {
      comp.material = { id: u.materialId, name: u.materialName ?? u.material }
    }
  }
  for (const c of byType.values()) c.toothNumbers.sort((a, b) => a - b)
  return [...byType.values()]
}

function buildDataQuality(
  parsed: ParsedOrder,
  scanSettings: ScanSettings | null,
  assets: Asset[],
  hadMaterialsXml: boolean,
  mapped: MappedDraft,
): DataQuality {
  const warnings: DataQualityWarning[] = [...mapped.warnings]
  const errors: DataQuality['errors'] = []

  const unknownClasses = [
    ...new Set(parsed.units.filter((u) => u.group === 'unknown' && u.toothClass).map((u) => u.toothClass)),
  ]
  for (const cls of unknownClasses) {
    warnings.push({
      code: 'UNKNOWN_TOOTH_CLASS',
      message: `CacheToothTypeClass "${cls}" is not in the normalisation map — treated as Unknown.`,
    })
  }

  if (!parsed.order.patientName) {
    warnings.push({
      code: 'PATIENT_NAME_UNAVAILABLE',
      message: 'Patient name unavailable in the source XML (not stored on cases anyway).',
    })
  }

  for (const m of parsed.raw.modelElements) {
    if (m.ModelFilename && !resolveAsset(assets, m.ModelFilename)) {
      warnings.push({
        code: 'MODEL_FILE_NOT_FOUND',
        message: `ModelFilename "${m.ModelFilename}" is referenced but not present in the package.`,
      })
    }
  }
  for (const s of parsed.raw.scans) {
    if (s.FileName && !resolveAsset(assets, s.FileName)) {
      warnings.push({
        code: 'SCAN_FILE_NOT_FOUND',
        message: `Scan FileName "${s.FileName}" is referenced but not present in the package.`,
      })
    }
  }

  if (!hadMaterialsXml) {
    warnings.push({
      code: 'NO_MATERIALS_XML',
      message: 'No Materials.xml in the package — material / sub-type names fall back to raw ids.',
    })
  }
  if (!scanSettings) {
    warnings.push({
      code: 'NO_SCAN_SETTINGS',
      message: 'No SID_UserInputData.XML — articulator / die / model-base fields default and are flagged.',
    })
  }
  if (assets.some((a) => a.encrypted)) {
    warnings.push({
      code: 'ENCRYPTED_ENTRIES',
      message: 'Password-protected .3ml entries were skipped — nothing needed for case creation lives in them.',
    })
  }

  const requiresReview =
    warnings.some((w) => REVIEW_CODES.has(w.code)) || errors.length > 0 || mapped.category == null

  return { valid: errors.length === 0, requiresReview, warnings, errors }
}

export interface AssembleInput {
  packageName: string
  parsed: ParsedOrder
  scanSettings: ScanSettings | null
  assets: Asset[]
  hadMaterialsXml: boolean
  mapped: MappedDraft
}

export function assembleThreeShapeCase(input: AssembleInput): ThreeShapeCase {
  const { packageName, parsed, scanSettings, assets, hadMaterialsXml, mapped } = input
  const o = parsed.raw.order
  const firstModel = parsed.raw.modelElements[0] ?? {}

  const toothElements = buildToothElements(parsed)
  const components = buildComponents(parsed)
  const toothNumbers = [
    ...new Set(toothElements.map((t) => t.toothNumber).filter((n): n is number => n != null)),
  ].sort((a, b) => a - b)
  const rawToothClasses = [...new Set(toothElements.map((t) => t.rawClass).filter(Boolean))]
  const normalizedClasses = [...new Set(components.map((c) => c.type))]

  return {
    source: {
      system: '3shape',
      containerVersion: parsed.raw.containerVersion,
      parserVersion: PARSER_VERSION,
      packageName,
      extractedAt: new Date().toISOString(),
    },
    sourceIds: {
      sourceOrderId: nn(o.IntOrderID),
      numericOrderId: nn(o.NumOrderID),
      externalOrderId: nn(o.ExtOrderID),
      importOrderId: nn(o.ImportOrderID),
      originalOrderId: nn(o.OriginalOrderID),
      clientOrderNo: nn(o.ClientOrderNo),
      sourceClientId: nn(o.ClientID),
    },
    patient: {
      refNo: nn(o.Patient_RefNo),
      firstName: nn(o.Patient_FirstName),
      lastName: nn(o.Patient_LastName),
      fullName: parsed.order.patientName,
      guid: nn(o.PatientGuid),
    },
    order: {
      customer: nn(o.Customer),
      manufacturerName: nn(o.ManufName),
      erpCustomerNo: nn(o.ERPCustomerNo) ?? nn(o.ShipToERPCustNo),
      contactPerson: nn(o.ClientContactPerson),
      comments: parsed.order.comments || null,
      importance: nn(o.OrderImportanceID),
      operatorId: nn(o.OperatorID),
      operatorName: nn(o.OperatorName),
      source: {
        createdFromApp: nn(o.CreatedFromApp),
        designModule: nn(o.DesignModuleID),
        modelDesignModule: nn(o.ModelDesignModule),
        scanModule: nn(o.ScanModuleID),
        faceScanModule: nn(o.FaceScanModuleID),
        scanSource: nn(o.ScanSource),
        modelManufacturingId: nn(o.ModelManufacturingID),
      },
      rawItems: parsed.order.itemsSummary || null,
    },
    classification: {
      category: mapped.category ?? 'Unknown',
      scriptCategory: mapped.scriptCategory,
      rawToothClasses,
      normalizedClasses,
      subtypeIds: [...new Set(toothElements.map((t) => t.rawSubtypeId).filter((s): s is string => Boolean(s)))],
      toothNumbers,
      isMultiComponent: components.length > 1,
      components,
    },
    modelJobs: parsed.raw.modelJobs.map((j) => ({
      modelJobId: j.ModelJobID,
      orderId: nn(j.OrderID),
    })),
    modelElements: buildModelElements(parsed, assets),
    toothElements,
    relationships: {
      links: parsed.raw.links.map((l) => ({
        linkId: l.LinkID,
        linkTypeId: nn(l.LinkTypeID),
        cacheLinkTypeClass: nn(l.CacheLinkTypeClass),
        modelElementId: nn(l.ModelElementID),
      })),
      linkToothElements: parsed.raw.linkToothElements.map((l) => ({
        linkToothElementId: l.LinkToothElementID,
        linkId: l.LinkID,
        toothElementId: l.ToothElementID,
      })),
      splitBridgeLinks: parsed.raw.splitBridgeLinks,
      connectorSpans: parsed.connectorGroups,
    },
    scans: buildScans(parsed, assets),
    attachments: parsed.raw.attachments.map((a) => ({
      attachmentId: nn(a.OrderExchangeAttachmentID) ?? nn(a.AttachmentID),
      type: nn(a.AttachmentType),
      fileName: nn(a.Name) ?? nn(a.FileName),
      path: nn(a.Path),
      resolvedAssetPath: resolveAsset(assets, a.Path ?? a.Name ?? a.FileName),
    })),
    assets,
    customData: parsed.raw.customData.map((c) => ({
      customDataId: nn(c.CustomDataID),
      fieldId: nn(c.FieldID),
      fieldCaption: nn(c.FieldCaption),
      value: nn(c.Value),
      kind: c.Kind === 'cdkPublic' ? 'public' : c.Kind === 'cdkInternal' ? 'internal' : c.Kind || 'unknown',
    })),
    sourceStatus: {
      processStatusId: nn(firstModel.ProcessStatusID),
      altProcessStatusId: nn(firstModel.AltProcessStatusID),
      processLockId: nn(firstModel.ProcessLockID),
      validationResult: nn(firstModel.ValidationResult),
    },
    timestamps: {
      createDate: parsed.order.createDate,
      deliveryDate: parsed.order.deliveryDate,
      shippingDate: unixToIso(firstModel.ShippingDate),
      receiveDate: unixToIso(firstModel.ReceiveDate),
      maxScanDate: parsed.order.scanDate,
    },
    dataQuality: buildDataQuality(parsed, scanSettings, assets, hadMaterialsXml, mapped),
  }
}
