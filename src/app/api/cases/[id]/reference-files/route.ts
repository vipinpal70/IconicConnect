import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseReferenceFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, desc } from 'drizzle-orm';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

/**
 * Read-only — reference images (case-modification-plan.md §2) are attached
 * only at case-creation time, through POST /api/cases's `referenceImages`
 * field. Mirrors [id]/preview-files/route.ts's GET (same auth pattern),
 * minus the POST — there's no separate "attach a reference image after the
 * fact" flow yet.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const effectiveClientId = profile.role === 'subuser' ? (profile.createdBy ?? profile.id) : profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientId) {
      return NextResponse.json({ error: 'Forbidden: You can only view reference images for cases from your lab' }, { status: 403 });
    }

    const images = await db.select().from(caseReferenceFiles)
      .where(eq(caseReferenceFiles.caseId, id))
      .orderBy(desc(caseReferenceFiles.createdAt));

    return NextResponse.json({ data: images });
  } catch (error: unknown) {
    console.error('Get case reference files error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
