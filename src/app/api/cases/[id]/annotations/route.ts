import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases } from '@/src/db/schema/case';
import { annotationDocuments, annotationVersions } from '@/src/db/schema/annotation';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq } from 'drizzle-orm';
import type { AnnotationLayer } from '@/src/types/annotation';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

const AUTHORIZED_ROLES = new Set(['admin', 'qc', 'designer', 'account_manager', 'client', 'subuser']);

/**
 * GET /api/cases/:id/annotations
 * Load the latest confirmed annotation document from PostgreSQL.
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

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const effectiveClientId = profile.clientId ?? profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientId) {
      return NextResponse.json({ error: 'Forbidden: You can only view annotations for your lab cases' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(annotationDocuments)
      .where(eq(annotationDocuments.caseId, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({
        success: true,
        document: null,
        revision: 0,
      });
    }

    const docData = (doc.documentData as { layers?: AnnotationLayer[] }) || {};

    return NextResponse.json({
      success: true,
      document: {
        id: doc.id,
        caseId: doc.caseId,
        revision: doc.revision,
        schemaVersion: doc.schemaVersion,
        layers: Array.isArray(docData.layers) ? docData.layers : [],
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      },
      revision: doc.revision,
      updatedAt: doc.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    console.error('Failed to load annotations:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

/**
 * PUT /api/cases/:id/annotations
 * Explicit Save: atomic persistence with revision checking (optimistic concurrency control).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleSave(req, await params);
}

/**
 * POST /api/cases/:id/annotations (alias for PUT)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleSave(req, await params);
}

export async function handleSave(
  req: NextRequest,
  { id }: { id: string }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile || !AUTHORIZED_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to edit annotations' }, { status: 403 });
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const effectiveClientId = profile.clientId ?? profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      schemaVersion = 1,
      expectedRevision = 0,
      layers = [],
    } = body as {
      schemaVersion?: number;
      expectedRevision?: number;
      layers?: AnnotationLayer[];
      saveReason?: string;
    };

    if (!Array.isArray(layers)) {
      return NextResponse.json({ error: 'Invalid payload: layers must be an array' }, { status: 400 });
    }

    // Basic payload size safety check (< 10MB)
    const payloadStr = JSON.stringify(layers);
    if (payloadStr.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Annotation payload exceeds maximum allowed size (10MB)' }, { status: 413 });
    }

    // Execute atomic transaction for persistence and revision control
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(annotationDocuments)
        .where(eq(annotationDocuments.caseId, id))
        .limit(1);

      const now = new Date();

      if (existing) {
        // Revision conflict check: if expectedRevision does not match current saved revision, reject with 409
        if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== existing.revision) {
          return {
            conflict: true,
            currentRevision: existing.revision,
          };
        }

        const nextRevision = existing.revision + 1;

        const [updated] = await tx
          .update(annotationDocuments)
          .set({
            revision: nextRevision,
            schemaVersion,
            documentData: { layers },
            updatedBy: user.id,
            updatedAt: now,
          })
          .where(eq(annotationDocuments.id, existing.id))
          .returning();

        // Audit version log
        await tx.insert(annotationVersions).values({
          documentId: existing.id,
          caseId: id,
          revision: nextRevision,
          documentData: { layers },
          savedBy: user.id,
          savedAt: now,
        });

        return {
          conflict: false,
          documentId: updated.id,
          revision: nextRevision,
          savedAt: now.toISOString(),
        };
      } else {
        // First save for this case (initial revision = 1)
        const [inserted] = await tx
          .insert(annotationDocuments)
          .values({
            caseId: id,
            revision: 1,
            schemaVersion,
            documentData: { layers },
            createdBy: user.id,
            updatedBy: user.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        await tx.insert(annotationVersions).values({
          documentId: inserted.id,
          caseId: id,
          revision: 1,
          documentData: { layers },
          savedBy: user.id,
          savedAt: now,
        });

        return {
          conflict: false,
          documentId: inserted.id,
          revision: 1,
          savedAt: now.toISOString(),
        };
      }
    });

    if (result.conflict) {
      return NextResponse.json(
        {
          error: 'Revision conflict: This document was modified by another user or session.',
          conflict: true,
          currentRevision: result.currentRevision,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      revision: result.revision,
      savedAt: result.savedAt,
    });
  } catch (error: unknown) {
    console.error('Save annotations error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
