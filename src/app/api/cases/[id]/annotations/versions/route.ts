import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases } from '@/src/db/schema/case';
import { annotationVersions } from '@/src/db/schema/annotation';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq, desc } from 'drizzle-orm';
import type { AnnotationLayer } from '@/src/types/annotation';

/**
 * GET /api/cases/:id/annotations/versions
 * Audit log of committed revisions for this case.
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

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const versions = await db
      .select({
        id: annotationVersions.id,
        documentId: annotationVersions.documentId,
        revision: annotationVersions.revision,
        documentData: annotationVersions.documentData,
        savedBy: annotationVersions.savedBy,
        savedAt: annotationVersions.savedAt,
        saverName: profiles.fullName,
      })
      .from(annotationVersions)
      .leftJoin(profiles, eq(annotationVersions.savedBy, profiles.id))
      .where(eq(annotationVersions.caseId, id))
      .orderBy(desc(annotationVersions.revision))
      .limit(30);

    const formatted = versions.map((v) => {
      const data = (v.documentData as { layers?: AnnotationLayer[] }) || {};
      const layers = Array.isArray(data.layers) ? data.layers : [];
      const totalAnnotations = layers.reduce((acc, l) => acc + (l.annotations?.length || 0), 0);

      return {
        id: v.id,
        documentId: v.documentId,
        revision: v.revision,
        savedBy: v.saverName || 'User',
        savedAt: v.savedAt.toISOString(),
        layerCount: layers.length,
        annotationCount: totalAnnotations,
      };
    });

    return NextResponse.json({ success: true, versions: formatted });
  } catch (error: unknown) {
    console.error('Failed to load annotation versions:', error);
    return NextResponse.json({ error: 'Failed to load versions' }, { status: 500 });
  }
}
