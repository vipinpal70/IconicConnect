/**
 * A package with scan meshes but no 3Shape order XML.
 *
 * Almost nothing about the case can be derived — every case-form field is left
 * for a human. We still inventory the archive so the client sees what they
 * uploaded (xml-work-plan.md §13; spec: "empty XML FileName ≠ no scan").
 */
import type { Asset, DataQuality, ThreeShapeCase } from './model'
import { PARSER_VERSION } from './version'
import type { MappedDraft } from './map-to-case'

const MESH_KINDS: ReadonlySet<string> = new Set(['CAD', 'SCAN', 'ANATOMY', 'EXTERNAL_MODEL'])

/** True when the package carries scan/CAD meshes (so it's a real, if bare, upload). */
export function hasMeshAssets(assets: Asset[]): boolean {
  return assets.some((a) => MESH_KINDS.has(a.kind))
}

export function rawScanDraft(): MappedDraft {
  return {
    category: null,
    scriptCategory: 'Unknown',
    subTypeData: { teeth: [], toothSystem: 'USA', notes: 'Imported from a 3Shape package with no order file — every field must be filled in manually.' },
    warnings: [
      {
        code: 'NO_ORDER_XML',
        message:
          'This package has scan meshes only — no 3Shape DentalContainer, so it carries no indication, tooth numbers, material or comments.',
      },
    ],
  }
}

export function rawScanThreeShapeCase(packageName: string, assets: Asset[]): ThreeShapeCase {
  const dataQuality: DataQuality = {
    valid: true,
    requiresReview: true,
    warnings: rawScanDraft().warnings,
    errors: [],
  }
  return {
    source: {
      system: '3shape',
      containerVersion: null,
      parserVersion: PARSER_VERSION,
      packageName,
      extractedAt: new Date().toISOString(),
    },
    sourceIds: {
      sourceOrderId: null, numericOrderId: null, externalOrderId: null, importOrderId: null,
      originalOrderId: null, clientOrderNo: null, sourceClientId: null,
    },
    patient: { refNo: null, firstName: null, lastName: null, fullName: null, guid: null },
    order: {
      customer: null, manufacturerName: null, erpCustomerNo: null, contactPerson: null,
      comments: null, importance: null, operatorId: null, operatorName: null,
      source: {
        createdFromApp: null, designModule: null, modelDesignModule: null, scanModule: null,
        faceScanModule: null, scanSource: null, modelManufacturingId: null,
      },
      rawItems: null,
    },
    classification: {
      category: 'Unknown', scriptCategory: 'Unknown', rawToothClasses: [], normalizedClasses: [],
      subtypeIds: [], toothNumbers: [], isMultiComponent: false, components: [],
    },
    modelJobs: [], modelElements: [], toothElements: [],
    relationships: { links: [], linkToothElements: [], splitBridgeLinks: [], connectorSpans: [] },
    scans: [], attachments: [], assets, customData: [],
    sourceStatus: { processStatusId: null, altProcessStatusId: null, processLockId: null, validationResult: null },
    timestamps: { createDate: null, deliveryDate: null, shippingDate: null, receiveDate: null, maxScanDate: null },
    dataQuality,
  }
}
