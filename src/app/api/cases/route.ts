import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseFiles } from '@/src/db/schema/case';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, inArray } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { generateCaseId } from '@/src/lib/case-utils';
import { logActivity } from '@/src/lib/activity-log';
import { notifyCaseSubmitted } from '@/src/lib/notifications/notification-dispatcher';
import { getCasesChatMetadata } from '@/src/lib/chat';

const caseListSelection = {
  id: cases.id,
  clientId: cases.clientId,
  subuserId: cases.subuserId,
  caseNumber: cases.caseNumber,
  category: cases.category,
  subTypeData: cases.subTypeData,
  status: cases.status,
  holdReason: cases.holdReason,
  cancelReason: cases.cancelReason,
  feedbackReason: cases.feedbackReason,
  rejectReason: cases.rejectReason,
  designerId: cases.designerId,
  qcId: cases.qcId,
  accountManagerId: cases.accountManagerId,
  dueDate: cases.dueDate,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
  outputFile: cases.outputFile,
  previewFile: cases.previewFile,
  preferredTeethLibrary: cases.preferredTeethLibrary,
  teethLibraryFileUrl: cases.teethLibraryFileUrl,
  teethLibraryFileName: cases.teethLibraryFileName,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

export async function POST(req: NextRequest) {
  try {
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

    const formData = await req.formData();
    const casesJson = formData.get('cases') as string;
    const files = formData.getAll('files') as File[];

    if (!casesJson) {
      return NextResponse.json({ error: 'No cases data provided' }, { status: 400 });
    }

    const casesData = JSON.parse(casesJson);
    const isArray = Array.isArray(casesData);
    const casesArray = isArray ? casesData : [casesData];

    let clientId: string | undefined;
    let subuserId: string | null = null;

    // We assume the first case's clientId or profile determines the client for the batch
    const firstCase = casesArray[0];

    if (isValidRoleForType('admin_portal', profile.role)) {
      if (!firstCase.clientId) {
        return NextResponse.json({ error: 'Client ID is required for admins creating a case' }, { status: 400 });
      }
      clientId = firstCase.clientId;
    } else if (profile.role === 'client') {
      clientId = profile.id;
    } else if (profile.role === 'subuser') {
      const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
      if (!subUserRecord.length) {
        return NextResponse.json({ error: 'Subuser parent client not found' }, { status: 400 });
      }
      clientId = subUserRecord[0].clientId;
      subuserId = profile.id;
    } else {
      return NextResponse.json({ error: 'Unauthorized to create a case' }, { status: 403 });
    }

    if (!clientId) {
      return NextResponse.json({ error: 'Failed to determine Client ID' }, { status: 400 });
    }

    // Fetch client profile to get lab name for folder structure
    const clientProfile = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1).then(res => res[0]);
    const labName = clientProfile?.labName || 'UnknownLab';

    const results = [];

    for (let i = 0; i < casesArray.length; i++) {
      const caseData = casesArray[i];
      const file = files[i];

      const caseNumber = caseData.caseNumber || generateCaseId(caseData.category);

      const newCase = {
        clientId,
        subuserId,
        caseNumber,
        dueDate: caseData.dueDate ? new Date(caseData.dueDate) : null,
        category: caseData.category,
        subTypeData: caseData.subTypeData,
        preferredTeethLibrary: caseData.preferredTeethLibrary || 'default',
        teethLibraryFileUrl: caseData.teethLibraryFileUrl || null,
        teethLibraryFileName: caseData.teethLibraryFileName || null,
      };

      const insertedCase = await db.insert(cases).values(newCase).returning().then(res => res[0]);

      await notifyCaseSubmitted({
        actorUserId: user.id,
        caseId: insertedCase.id,
        caseNumber: insertedCase.caseNumber ?? '',
        category: insertedCase.category ?? '',
        clientName: clientProfile?.labName || clientProfile?.fullName || clientProfile?.email || 'Client',
      }).catch((err) => console.error('[CaseNotificationTrigger] Failed to dispatch case submission notification:', err));

      if (caseData.uploadedFile) {
        // Already uploaded immediately by client
        await db.insert(caseFiles).values({
          caseId: insertedCase.id,
          uploadedBy: user.id,
          fileName: caseData.uploadedFile.fileName,
          fileUrl: caseData.uploadedFile.fileUrl,
          fileType: caseData.uploadedFile.fileType,
          fileSize: caseData.uploadedFile.fileSize,
        });
      } else if (file) {
        // Legacy/Direct fallback upload
        const storagePath = `case_data/${labName}/${caseNumber}/${file.name}`;

        const { error: uploadError } = await supabase
          .storage
          .from('case-files')
          .upload(storagePath, file, { upsert: true });

        if (uploadError) {
          console.error(`Failed to upload file for case ${caseNumber}:`, uploadError);
        } else {
          const { data: publicUrlData } = supabase
            .storage
            .from('case-files')
            .getPublicUrl(storagePath);

          await db.insert(caseFiles).values({
            caseId: insertedCase.id,
            uploadedBy: user.id,
            fileName: file.name,
            fileUrl: publicUrlData.publicUrl,
            fileType: file.type,
            fileSize: file.size,
          });
        }
      }

      await logActivity({
        actor: profile,
        action: 'case.created',
        caseId: insertedCase.id,
        details: {
          caseNumber: insertedCase.caseNumber,
          category: insertedCase.category,
          clientId: insertedCase.clientId,
          subuserId: insertedCase.subuserId,
          status: insertedCase.status,
          hasUploadedFile: Boolean(caseData.uploadedFile || file),
        },
      });

      results.push(insertedCase);
    }

    return NextResponse.json({ data: isArray ? results : results[0] }, { status: 201 });
  } catch (error: unknown) {
    console.error('Create case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
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

    let results;

    if (isValidRoleForType('admin_portal', profile.role)) {
      // Admin sees all cases
      results = await db.select(caseListSelection).from(cases);
    } else if (profile.role === 'client') {
      // Client sees their own cases and cases created by their subusers (which also have clientId = client's id)
      results = await db.select(caseListSelection).from(cases).where(eq(cases.clientId, profile.id));
    } else if (profile.role === 'subuser') {
      // Subuser sees only cases they created
      results = await db.select(caseListSelection).from(cases).where(eq(cases.subuserId, profile.id));
    } else {
      return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 });
    }

    const designerIds = Array.from(new Set(results.map(r => r.designerId).filter(Boolean))) as string[];
    const designersMap = new Map<string, string>();
    if (designerIds.length > 0) {
      const designersProfiles = await db.select().from(profiles).where(inArray(profiles.id, designerIds));
      designersProfiles.forEach(p => {
        designersMap.set(p.id, p.fullName || p.email);
      });
    }

    const chatMetadata = await getCasesChatMetadata(results.map((r) => r.id), profile.id);

    const mappedResults = results.map(r => ({
      ...r,
      designerName: r.designerId ? (designersMap.get(r.designerId) || null) : null,
      todayMessagesCount: chatMetadata.get(r.id)?.todayMessagesCount ?? 0,
      hasUnreadChat: chatMetadata.get(r.id)?.hasUnreadChat ?? false,
    }));

    return NextResponse.json({ data: mappedResults });
  } catch (error: unknown) {
    console.error('Get cases error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
