import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { createClient } from '@/src/lib/supabase/server';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET } from '@/src/lib/r2';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

const ALLOWED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg',
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg',
  '.pdf',
  '.zip',
  '.dme',
  '.doc', '.docx',
  '.txt',
  '.html', '.htm',
];

type AuthedProfile = NonNullable<Awaited<ReturnType<typeof getAuthedProfile>>['profile']>;

/** Resolve the authenticated user + their profile. */
async function getAuthedProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const profile = profileResult[0];
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) };
  }
  return { user, profile };
}

/** Determine which client (and lab) an upload belongs to, mirroring the legacy route. */
async function resolveClientContext(profile: AuthedProfile, adminClientId: string | null) {
  let clientId: string | undefined;
  let labName = 'UnknownLab';

  if (isValidRoleForType('admin_portal', profile.role)) {
    clientId = adminClientId || profile.id;
  } else if (profile.role === 'client') {
    clientId = profile.id;
    labName = profile.labName || 'UnknownLab';
  } else if (profile.role === 'subuser') {
    const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
    if (!subUserRecord.length) {
      return { error: NextResponse.json({ error: 'Subuser parent client not found' }, { status: 400 }) };
    }
    clientId = subUserRecord[0].clientId;
  }

  if (!clientId) {
    return { error: NextResponse.json({ error: 'Failed to determine Client ID' }, { status: 400 }) };
  }

  if (profile.role !== 'client') {
    if (clientId === profile.id) {
      labName = profile.labName || 'UnknownLab';
    } else {
      const clientProfile = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1).then(r => r[0]);
      labName = clientProfile?.labName || 'UnknownLab';
    }
  }

  return { clientId, labName };
}

/** Object key inside the R2 bucket. Deterministic so the auth-protected download proxy can rebuild it. */
function objectKey(labName: string, fileName: string) {
  return `${labName}/${fileName}`;
}

/** Auth-protected download proxy URL stored in case_files.fileUrl (keeps role-based access control). */
function buildFileUrl(labName: string, fileName: string) {
  return `/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`;
}

// ── Step 1: initialise the multipart upload ──────────────────────────────────
async function handleInit(req: NextRequest, profile: AuthedProfile) {
  const { searchParams } = new URL(req.url);
  const fileName = searchParams.get('fileName');
  const fileType = searchParams.get('fileType') || 'application/octet-stream';
  const fileSize = Number(searchParams.get('fileSize') || 0);
  const adminClientId = searchParams.get('clientId');

  if (!fileName) {
    return NextResponse.json({ error: 'File Name is required' }, { status: 400 });
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File size exceeds the 5GB limit' }, { status: 400 });
  }
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
  }

  const ctx = await resolveClientContext(profile, adminClientId);
  if ('error' in ctx) return ctx.error;

  const key = objectKey(ctx.labName, fileName);
  const created = await r2.send(new CreateMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: fileType,
  }));

  return NextResponse.json({
    success: true,
    uploadId: created.UploadId,
    key,
    labName: ctx.labName,
    fileName,
    fileUrl: buildFileUrl(ctx.labName, fileName),
  });
}

// ── Step 2: hand the browser presigned UploadPart URLs ───────────────────────
// The client PUTs each chunk straight to R2 (no relay through this server), so
// upload bandwidth isn't doubled and parallel parts can saturate the client's uplink.
const PART_URL_TTL = 6 * 60 * 60; // 6h — long enough for a multi-GB upload

async function handleSign(req: NextRequest) {
  const { key, uploadId, totalParts } = await req.json() as {
    key: string;
    uploadId: string;
    totalParts: number;
  };

  if (!key || !uploadId || !totalParts || totalParts < 1) {
    return NextResponse.json({ error: 'Missing key, uploadId or totalParts' }, { status: 400 });
  }

  const urls = await Promise.all(
    Array.from({ length: totalParts }, (_, i) => {
      const partNumber = i + 1;
      return getSignedUrl(
        r2,
        new UploadPartCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PART_URL_TTL },
      ).then((url) => ({ partNumber, url }));
    }),
  );

  return NextResponse.json({ success: true, urls });
}

// ── Step 3: assemble the object from the uploaded parts ──────────────────────
async function handleComplete(req: NextRequest) {
  const body = await req.json();
  const { key, uploadId, labName, fileName, fileSize, fileType, parts } = body as {
    key: string;
    uploadId: string;
    labName: string;
    fileName: string;
    fileSize?: number;
    fileType?: string;
    parts: Array<{ PartNumber: number; ETag: string }>;
  };

  if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: 'Missing key, uploadId or parts' }, { status: 400 });
  }

  const orderedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

  await r2.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: orderedParts },
  }));

  return NextResponse.json({
    success: true,
    fileUrl: buildFileUrl(labName, fileName),
    fileName,
    fileSize: fileSize ?? null,
    fileType: fileType ?? 'application/octet-stream',
    storagePath: key,
    key,
  });
}

// ── Cleanup: abort a partially uploaded object ───────────────────────────────
async function handleAbort(req: NextRequest) {
  const { key, uploadId } = await req.json();
  if (!key || !uploadId) {
    return NextResponse.json({ error: 'Missing key or uploadId' }, { status: 400 });
  }
  await r2.send(new AbortMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
  }));
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedProfile();
    if ('error' in auth) return auth.error;

    const action = new URL(req.url).searchParams.get('action');

    switch (action) {
      case 'init':
        return await handleInit(req, auth.profile);
      case 'sign':
        return await handleSign(req);
      case 'complete':
        return await handleComplete(req);
      case 'abort':
        return await handleAbort(req);
      default:
        return NextResponse.json({ error: 'Unknown or missing action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('R2 multipart upload route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
