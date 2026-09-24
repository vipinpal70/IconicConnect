import { resolveCaseSubCategory } from '@/src/lib/pricing'

// Structural, not the full `Case` row — lets callers that only selected a
// handful of columns (e.g. a joined dashboard query) pass their row through
// without a cast, while a full `Case` row still satisfies it as-is.
export interface MillingCaseViewSource {
  id: string
  caseNumber: string | null
  category: string | null
  subTypeData: unknown
  dueDate: Date | null
}

export interface MillingCaseView {
  caseId: string
  caseNumber: string | null
  category: string | null
  subCategory: string | null
  toothNumbers: number[]
  modelRequired: boolean
  dueDate: string | null
}

function extractToothNumbers(subTypeData: unknown): number[] {
  const data = (subTypeData as Record<string, unknown>) || {}
  const teeth = Array.isArray(data.teeth)
    ? data.teeth
    : Array.isArray(data.crownBridgeTeeth)
      ? data.crownBridgeTeeth
      : []
  return teeth.filter((t): t is number => typeof t === 'number')
}

/**
 * Projects a case row down to exactly what a milling centre is allowed to
 * see: restoration type, teeth, model requirement, due date. Never includes
 * clientId or any other client-identifying field — shipToName/shipToAddress
 * on the assignment are the only client-identifying data a milling centre gets.
 */
export function toMillingCaseView(caseRecord: MillingCaseViewSource): MillingCaseView {
  const data = (caseRecord.subTypeData as Record<string, unknown>) || {}
  return {
    caseId: caseRecord.id,
    caseNumber: caseRecord.caseNumber,
    category: caseRecord.category,
    subCategory: caseRecord.category ? resolveCaseSubCategory(caseRecord.category, caseRecord.subTypeData) : null,
    toothNumbers: extractToothNumbers(caseRecord.subTypeData),
    modelRequired: data.modelRequired === 'yes',
    dueDate: caseRecord.dueDate ? caseRecord.dueDate.toISOString() : null,
  }
}
