import { and, eq, type SQL } from 'drizzle-orm';
import { cases } from '@/src/db/schema/case';

/**
 * Which cases a user may attach design outputs to through bulk upload.
 *
 *   designer → in-progress cases they are the assigned designer of
 *   qc       → in-progress cases they are the assigned QC of
 *   admin    → every in-progress case
 *
 * The match route uses the SQL filter (so users only ever see their own cases) and the confirm route
 * re-checks the loaded row with `canBulkAttachOutput` (so a crafted request can't reach other cases).
 */

export const BULK_UPLOAD_ROLES = new Set(['designer', 'qc', 'admin']);
export const BULK_ELIGIBLE_STATUS = 'in_progress';

interface Actor {
  id: string;
  role: string;
}

interface CaseOwnership {
  status: string;
  designerId: string | null;
  qcId: string | null;
}

export function bulkEligibleCasesFilter(actor: Actor): SQL | undefined {
  const inProgress = eq(cases.status, BULK_ELIGIBLE_STATUS);
  if (actor.role === 'admin') return inProgress;
  if (actor.role === 'designer') return and(inProgress, eq(cases.designerId, actor.id));
  if (actor.role === 'qc') return and(inProgress, eq(cases.qcId, actor.id));
  return undefined;
}

/** Null when allowed, otherwise the reason (shown to the user per item). */
export function bulkAttachDenialReason(actor: Actor, c: CaseOwnership): string | null {
  if (c.status !== BULK_ELIGIBLE_STATUS) return `Case is no longer in progress (status: ${c.status})`;
  if (actor.role === 'admin') return null;
  if (actor.role === 'designer' && c.designerId === actor.id) return null;
  if (actor.role === 'qc' && c.qcId === actor.id) return null;
  return actor.role === 'qc' ? 'You are not the assigned QC for this case' : 'You are not the assigned designer for this case';
}
