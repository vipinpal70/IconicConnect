/**
 * Pure state helpers for the 3Shape import carousel — extracted so they can be
 * unit-tested without a DOM. The component holds `DraftState[]`; these functions
 * derive validity, which warnings are still "open", and which fields to flag.
 */
import { CASE_HIERARCHY } from "@/src/lib/case-hierarchy"
import type { DataQualityWarning } from "@/src/lib/three-shape/model"
import type { DraftSubTypeData } from "./DraftCaseForm"

export interface DraftLike {
  ok: boolean
  skip: boolean
  category: string | null
  subTypeData: DraftSubTypeData
  warnings: DataQualityWarning[]
  duplicateOf: unknown | null
}

/** A field counts as empty when it has no value (arrays: length 0). */
export function fieldIsEmpty(subTypeData: DraftSubTypeData, field: string): boolean {
  const v = subTypeData[field as keyof DraftSubTypeData]
  return Array.isArray(v) ? v.length === 0 : !v
}

/**
 * Warnings still worth showing: non-field ("informational") ones always, and
 * field warnings only while that field is still empty — so the amber shrinks as
 * the user fills things in.
 */
export function openWarnings(d: DraftLike): DataQualityWarning[] {
  return d.warnings.filter((w) => !w.field || fieldIsEmpty(d.subTypeData, w.field))
}

/** `subTypeData`-field names to ring amber on the form. */
export function highlightFields(d: DraftLike): string[] {
  return openWarnings(d)
    .map((w) => w.field)
    .filter((f): f is string => Boolean(f))
}

/** Whether a duplicate-flagged draft was kept by the user (→ force-create). */
export function isForced(d: DraftLike): boolean {
  return Boolean(d.duplicateOf) && !d.skip
}

/**
 * Can this draft be submitted as-is? Skipped drafts never block the batch.
 *
 * Category, the primary Case Type (caseType / caseType1 — enforced via
 * CASE_HIERARCHY's `optional` flags), a Tooth Selection, and (outside 3D
 * Model) an explicit Model Required choice are required. Every secondary
 * field — Arch, Occlusion, the Implant Crown & Bridge attachment and its
 * teeth, 3D Model's Model Type/Articulator/Drain Holes — is optional and
 * doesn't block submission (case-modification-plan.md §1 & §3, revised).
 */
export function draftValid(d: DraftLike): boolean {
  if (d.skip) return true
  if (!d.ok) return false
  if (!d.category) return false

  const fields = CASE_HIERARCHY[d.category]?.fields ?? []
  const dynOk = fields.every((f) => f.optional || Boolean(d.subTypeData[f.name]))
  if (!dynOk) return false

  const teethLen = Array.isArray(d.subTypeData.teeth) ? d.subTypeData.teeth.length : 0
  const teethOk =
    d.category === "3D Model" ? d.subTypeData.die !== "Yes" || teethLen > 0 : teethLen > 0
  if (!teethOk) return false

  // modelRequired doesn't apply to 3D Model (see DraftCaseForm/map-to-case) —
  // everywhere else the lab must actively pick Yes/No, same as the manual
  // case-creation forms.
  if (d.category !== "3D Model") {
    return d.subTypeData.modelRequired === "yes" || d.subTypeData.modelRequired === "no"
  }
  return true
}
