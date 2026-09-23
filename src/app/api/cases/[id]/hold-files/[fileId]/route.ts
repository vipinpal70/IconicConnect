import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseHoldFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { invalidateCasesCache } from '@/src/lib/redis-cache';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

/**
 * Post-hoc removal of a hold image. Deliberately tighter than
 * preview-files/[fileId]'s DELETE (any admin/qc/designer): hold images are
 * evidence for an `on_hold` transition that PUT /api/cases/[id] already
 * restricts to the case's assigned QC/designer, or admin (hold_images-plan.md
 * §4.3) — removing that evidence is held to the same ownership bar so a QC/
 * designer with no relationship to this case can't touch it either way.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const isOwner =
      profile.role === 'admin' ||
      (profile.role === 'qc' && (caseRecord.qcId === profile.id || caseRecord.designerId === profile.id)) ||
      (profile.role === 'designer' && caseRecord.designerId === profile.id);

    if (!isOwner) {
      return NextResponse.json({ error: 'Forbidden: Only Admin or the QC/Designer assigned to this case can remove hold images' }, { status: 403 });
    }

    const deleted = await db.delete(caseHoldFiles)
      .where(and(eq(caseHoldFiles.id, fileId), eq(caseHoldFiles.caseId, id)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Hold image not found' }, { status: 404 });
    }

    // The underlying R2 object is reaped by the existing orphan-cleanup job once
    // nothing references it — no synchronous storage delete needed here.
    logActivity({
      actor: profile,
      action: 'case.hold_file_deleted',
      caseId: id,
      details: { caseNumber: caseRecord.caseNumber, fileName: deleted[0].fileName },
    }).catch((err) => console.error('[HoldFiles] activity log failed:', err));

    await invalidateCasesCache(caseRecord.clientId);

    return NextResponse.json({ data: deleted[0] });
  } catch (error: unknown) {
    console.error('Delete case hold file error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
