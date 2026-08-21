import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, casePreviewFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { invalidateCasesCache } from '@/src/lib/redis-cache';

const UPLOAD_ROLES = new Set(['admin', 'qc', 'designer']);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

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

    if (!UPLOAD_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Only Admin, QC or Designer can remove preview files' }, { status: 403 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // The synthetic legacy row (id 'legacy') has no backing DB row — nothing to delete.
    // A real replacement upload naturally supersedes it since the table becomes non-empty.
    if (fileId === 'legacy') {
      return NextResponse.json({ data: { id: 'legacy' } });
    }

    const deleted = await db.delete(casePreviewFiles)
      .where(and(eq(casePreviewFiles.id, fileId), eq(casePreviewFiles.caseId, id)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Preview file not found' }, { status: 404 });
    }

    // The underlying R2 object is reaped by the existing orphan-cleanup job once
    // nothing references it — no synchronous storage delete needed here.
    logActivity({
      actor: profile,
      action: 'case.preview_file_deleted',
      caseId: id,
      details: { caseNumber: caseRecord.caseNumber, fileName: deleted[0].fileName },
    }).catch((err) => console.error('[PreviewFiles] activity log failed:', err));

    await invalidateCasesCache(caseRecord.clientId);

    return NextResponse.json({ data: deleted[0] });
  } catch (error: unknown) {
    console.error('Delete case preview file error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
