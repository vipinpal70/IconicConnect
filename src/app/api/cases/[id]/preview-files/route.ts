import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, casePreviewFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, desc, sql } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { invalidateCasesCache } from '@/src/lib/redis-cache';

const UPLOAD_ROLES = new Set(['admin', 'qc', 'designer']);
const MAX_PREVIEW_FILES = 5;
const MAX_PREVIEW_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

function legacyFileNameFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/[?&]fileName=([^&]+)/);
    if (match?.[1]) return match[1];
    const withoutQuery = decoded.split('?')[0];
    return withoutQuery.split('/').pop() || 'preview';
  } catch {
    return 'preview';
  }
}

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
      return NextResponse.json({ error: 'Forbidden: You can only view preview files for cases from your lab' }, { status: 403 });
    }

    const previewFiles = await db.select().from(casePreviewFiles)
      .where(eq(casePreviewFiles.caseId, id))
      .orderBy(desc(casePreviewFiles.createdAt));

    // Legacy fallback: cases uploaded before multi-preview support only have
    // cases.preview_file set, with no rows in this table. Synthesize one entry
    // so those cases keep rendering without a data migration.
    if (previewFiles.length === 0 && caseRecord.previewFile) {
      return NextResponse.json({
        data: [{
          id: 'legacy',
          caseId: id,
          uploadedBy: null,
          fileName: legacyFileNameFromUrl(caseRecord.previewFile),
          fileUrl: caseRecord.previewFile,
          fileType: null,
          fileSize: null,
          createdAt: caseRecord.updatedAt,
        }],
      });
    }

    return NextResponse.json({ data: previewFiles });
  } catch (error: unknown) {
    console.error('Get case preview files error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(
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

    if (!UPLOAD_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Only Admin, QC or Designer can upload preview files' }, { status: 403 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null) as {
      fileUrl?: string;
      fileName?: string;
      fileType?: string | null;
      fileSize?: number | null;
    } | null;

    if (!body?.fileUrl || !body?.fileName) {
      return NextResponse.json({ error: 'Missing fileUrl or fileName' }, { status: 400 });
    }

    if (typeof body.fileSize === 'number' && body.fileSize > MAX_PREVIEW_FILE_SIZE) {
      return NextResponse.json({ error: 'Preview file exceeds the 1GB limit' }, { status: 400 });
    }

    const existingCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(casePreviewFiles)
      .where(eq(casePreviewFiles.caseId, id))
      .then(res => res[0]?.count ?? 0);
    const legacyCount = existingCount === 0 && caseRecord.previewFile ? 1 : 0;
    if (existingCount + legacyCount >= MAX_PREVIEW_FILES) {
      return NextResponse.json({ error: `A case can have at most ${MAX_PREVIEW_FILES} preview files` }, { status: 400 });
    }

    const inserted = await db.insert(casePreviewFiles).values({
      caseId: id,
      uploadedBy: user.id,
      fileName: body.fileName,
      fileUrl: body.fileUrl,
      fileType: body.fileType ?? null,
      fileSize: body.fileSize ?? null,
    }).returning();

    await logActivity({
      actor: profile,
      action: 'case.preview_file_uploaded',
      caseId: id,
      details: {
        caseNumber: caseRecord.caseNumber,
        fileName: body.fileName,
        fileType: body.fileType ?? null,
        fileSize: body.fileSize ?? null,
      },
    });

    await invalidateCasesCache(caseRecord.clientId);

    return NextResponse.json({ data: inserted[0] }, { status: 201 });
  } catch (error: unknown) {
    console.error('Upload preview file error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
