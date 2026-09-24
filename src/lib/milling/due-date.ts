// Shared due-date urgency treatment for the milling portal — used by both
// the dashboard's due-soon strip and the cases list's Due column
// (milling-portal-plan.md §4 #1, §5 #4) so the two surfaces agree on what
// counts as "overdue" vs "due soon."
export type DueDateTone = 'overdue' | 'soon' | 'normal'

const SOON_WINDOW_DAYS = 2

export function dueDateTone(dueDate: string | null | undefined): DueDateTone {
  if (!dueDate) return 'normal'
  const diffDays = (new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= SOON_WINDOW_DAYS) return 'soon'
  return 'normal'
}

export const DUE_DATE_TONE_CLASSES: Record<DueDateTone, string> = {
  overdue: 'text-red-600 font-semibold',
  soon: 'text-amber-600 font-medium',
  normal: 'text-muted-foreground',
}
