import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';

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

    // Role checks for uploading files
    if (profile.role === 'subuser' && caseRecord.subuserId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only upload files to your own cases' }, { status: 403 });
    } else if (profile.role === 'client' && caseRecord.clientId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only upload files to cases from your lab' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const note = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim() : '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { error: uploadError } = await supabase
      .storage
      .from('case-files')
      .upload(fileName, file);

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 });
    }

    const { data: publicUrlData } = supabase
      .storage
      .from('case-files')
      .getPublicUrl(fileName);

    const insertedFile = await db.insert(caseFiles).values({
      caseId: id,
      uploadedBy: user.id,
      fileName: file.name,
      fileUrl: publicUrlData.publicUrl,
      note: note || null,
      fileType: file.type,
      fileSize: file.size,
    }).returning();

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

    // Role checks for viewing files
    if (profile.role === 'subuser' && caseRecord.subuserId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view files for your own cases' }, { status: 403 });
    } else if (profile.role === 'client' && caseRecord.clientId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view files for cases from your lab' }, { status: 403 });
    }

    const files = await db.select().from(caseFiles).where(eq(caseFiles.caseId, id));

    return NextResponse.json({ data: files });
  } catch (error: unknown) {
    console.error('Get case files error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
