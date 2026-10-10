import { getProfileLabName } from '@/src/lib/profile-utils';
import { putLabFile } from '@/src/lib/r2-put';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases,  } from '@/src/db/schema/case';
import { insertFiles, listByCase } from '@/src/lib/files-repo';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { invalidateCasesCache } from '@/src/lib/redis-cache';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
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

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Role checks for uploading files — sub-users share parent client's cases
    const effectiveClientId = profile.clientId ?? profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientId) {
      return NextResponse.json({ error: 'Forbidden: You can only upload files to cases from your lab' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const note = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim() : '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const [clientProfile] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1);
    const labName = clientProfile ? getProfileLabName(clientProfile) : '';
    if (!labName) return NextResponse.json({ error: 'Lab not found for case' }, { status: 400 });
    const safeName = file.name.replace(/[\\/]/g, '_');
    let fileUrl: string;
    try {
      fileUrl = await putLabFile(labName, `${caseRecord.caseNumber}/${Date.now()}-${safeName}`, file);
    } catch (uploadError) {
      console.error('R2 upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 });
    }

    const insertedFile = await insertFiles([{
      clientId: caseRecord.clientId,
      caseId: id,
      kind: 'scan',
      uploadedBy: user.id,
      fileName: file.name,
      fileUrl,
      note: note || null,
      fileType: file.type,
      fileSize: file.size,
    }]);

    await logActivity({
      actor: profile,
      action: 'case.file_uploaded',
      caseId: id,
      details: {
        caseNumber: caseRecord.caseNumber,
        fileName: file.name,
        note: note || null,
        fileType: file.type,
        fileSize: file.size,
      },
    });

    await invalidateCasesCache(caseRecord.clientId);

    return NextResponse.json({ data: insertedFile[0] }, { status: 201 });
  } catch (error: unknown) {
    console.error('Upload file error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
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

    // Role checks for viewing files — sub-users share parent client's cases
    const effectiveClientIdGet = profile.clientId ?? profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientIdGet) {
      return NextResponse.json({ error: 'Forbidden: You can only view files for cases from your lab' }, { status: 403 });
    }

    return NextResponse.json({ data: await listByCase(id, 'scan') });
  } catch (error: unknown) {
    console.error('Get case files error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
