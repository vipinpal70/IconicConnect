export const CASE_APPROVAL_CHECKLIST = [
  "Occlusion Plane",
  "Margin",
  "Insertion Direction",
  "Undercuts",
  "Contour and Shape",
  "Occlusion",
  "Interproximal contacts",
] as const

export type CaseApprovalChecklistItem = (typeof CASE_APPROVAL_CHECKLIST)[number]

export function normalizeCaseApprovalChecklist(input: unknown): CaseApprovalChecklistItem[] {
  if (!Array.isArray(input)) return []

  const selected = new Set(
    input.filter((item): item is CaseApprovalChecklistItem =>
      typeof item === "string" && CASE_APPROVAL_CHECKLIST.includes(item as CaseApprovalChecklistItem)
    )
  )

  return CASE_APPROVAL_CHECKLIST.filter((item) => selected.has(item))
}

