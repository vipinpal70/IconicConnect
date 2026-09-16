// Single source of truth for the case category/sub-type taxonomy consumed by
// the 3Shape XML import (src/lib/three-shape/taxonomy.ts, map-to-case.ts) and
// its review UI (src/components/ThreeShapeImport/). Mirrors — deliberately,
// field-for-field — the inline CASE_HIERARCHY already used by
// src/app/client/(dashboard)/cases/page.tsx, since that's the form the
// imported drafts are reviewed and submitted through.
//
// NOTE: this repo currently has THREE independently-drifted copies of this
// taxonomy (this page's, AddCaseDialog.tsx's, and the ops cases page's) —
// e.g. "Crown & Bridges" vs "Crown & Bridge", "Vineers" (typo, client page)
// vs "Veneers" (AddCaseDialog), and the ops page's Implant caseType2 using a
// completely different option set. This file intentionally matches the
// CLIENT page's copy only, since that's the one the 3Shape import tab is
// wired into — it does not attempt to reconcile the other two. See
// master2-plan.md for the full comparison.
//
// Unlike xml-feature's case-hierarchy.ts, this file has no price-list /
// service-catalog "isEnabled" enforcement helpers — that concept
// (client_price_list.is_enabled) doesn't exist on this branch's schema.

export interface CaseHierarchyField {
  name: string
  label: string
  type: string
  options: string[]
  optional?: boolean
}

export interface CaseHierarchyCategory {
  fields: CaseHierarchyField[]
}

// Category, a Case File, a Tooth Selection, and the primary "Case Type"
// selector (caseType / caseType1 — the field that names the specific
// service being requested) are required to submit a case. Every secondary
// field (Arch, Occlusion, the Implant Crown & Bridge attachment) is
// optional — still rendered so a lab can fill them in, but doesn't block
// submission when left blank (case-modification-plan.md §3, revised).
export const CASE_HIERARCHY: Record<string, CaseHierarchyCategory> = {
  'Crown & Bridges': {
    fields: [
      { name: 'caseType', label: 'Case Type', type: 'select', options: ['Crown', 'Bridge', 'Cutback', 'Coping', 'Screw Retained', 'In-Lay', 'On-Lay'] },
    ],
  },
  Denture: {
    fields: [
      { name: 'caseType1', label: 'Case Type 1', type: 'select', options: ['Reference Denture', 'Copy Denture', 'Immediate Denture', 'Full Denture', 'Partial Denture'] },
      { name: 'caseType2', label: 'Case Type 2', type: 'select', options: ['Lower', 'Upper', 'Both Arches'], optional: true },
    ],
  },
  Cosmetics: {
    fields: [
      // "Vineers" is a pre-existing typo in the client page's option list, not
      // a new one introduced here — kept verbatim so submitted cases match
      // what the manual form itself produces (see taxonomy.ts's alias entry).
      { name: 'caseType', label: 'Case Type', type: 'select', options: ['Digital Wax Up', 'Vineers', 'Snap on Smile'] },
    ],
  },
  Appliances: {
    fields: [
      { name: 'caseType1', label: 'Case Type 1', type: 'select', options: ['Night Guards', 'Sports Guard', 'Mouth Guard', 'NTI'] },
      { name: 'occlusion', label: 'Occlusion', type: 'select', options: ['even occlusion', 'custom'], optional: true },
      // No "Both Arches" here (unlike Denture below) — matches the client
      // page exactly. A scan that infers "Both Arches" for an appliance is
      // left unmapped/blank by the importer rather than forced to fit.
      { name: 'arch', label: 'Arch', type: 'select', options: ['Lower', 'Upper'], optional: true },
    ],
  },
  Implant: {
    fields: [
      { name: 'caseType1', label: 'Sub Type 1', type: 'select', options: ['Robotic', 'Custom', 'Ti-Base'] },
      { name: 'caseType2', label: 'Crown & Bridge type', type: 'select', options: ['None', 'Crown', 'Bridge'], optional: true },
    ],
  },
}
