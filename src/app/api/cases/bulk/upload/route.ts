import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { createClient } from '@/src/lib/supabase/server';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET } from '@/src/lib/r2';

/**
 * Bulk design-output upload — an INDEPENDENT multipart upload endpoint used by the
 * designer/QC "Bulk Upload" screen. It mirrors `src/app/api/cases/upload/route.ts`
 * but stages objects under a dedicated, collision-free prefix:
 *
 *   bulk-staging/<uploaderId>/<uuid>-<fileName>
 *
 * Objects live in staging until either `/api/cases/bulk/confirm` copies them into the
 * matched case's client `labName/fileName` namespace, or they are removed here (DELETE).
 * Nothing in this file touches the existing single-upload flow.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const PART_URL_TTL = 6 * 60 * 60; // 6h — long enough for a multi-GB upload
const STAGING_PREFIX = 'bulk-staging';

const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.sh', '.lnk', '.scr', '.vbs', '.js',
];

// Only operational roles that produce design output may bulk-upload.
const ALLOWED_ROLES = new Set(['designer', 'qc', 'admin']);

type AuthedProfile = NonNullable<Awaited<ReturnType<typeof getAuthedProfile>>['profile']>;

async function getAuthedProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const profile = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1).then(r => r[0]);
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) };
  }
  if (!ALLOWED_ROLES.has(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden: bulk upload is available to designers and QC only' }, { status: 403 }) };
  }
  return { user, profile };
}

/** Prefix owned by this uploader — used to authorise staging deletes. */
function stagingOwnerPrefix(uploaderId: string) {
  return `${STAGING_PREFIX}/${uploaderId}/`;
}

// ── Step 1: initialise the multipart upload into staging ─────────────────────
async function handleInit(req: NextRequest, profile: AuthedProfile) {
  const { searchParams } = new URL(req.url);
  const fileName = searchParams.get('fileName');
  const fileType = searchParams.get('fileType') || 'application/octet-stream';
  const fileSize = Number(searchParams.get('fileSize') || 0);

  if (!fileName) {
    return NextResponse.json({ error: 'File Name is required' }, { status: 400 });
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File size exceeds the 5GB limit' }, { status: 400 });
  }
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot !== -1 ? fileName.substring(lastDot).toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
  }

  const storageKey = `${stagingOwnerPrefix(profile.id)}${randomUUID()}-${fileName}`;
  const created = await r2.send(new CreateMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
    ContentType: fileType,
  }));

  return NextResponse.json({
    success: true,
    uploadId: created.UploadId,
    storageKey,
    fileName,
  });
}

// ── Step 2: hand the browser presigned UploadPart URLs ───────────────────────
async function handleSign(req: NextRequest) {
  const { storageKey, uploadId, totalParts } = await req.json() as {
    storageKey: string;
    uploadId: string;
    totalParts: number;
  };

  if (!storageKey || !uploadId || !totalParts || totalParts < 1) {
    return NextResponse.json({ error: 'Missing storageKey, uploadId or totalParts' }, { status: 400 });
  }

  const urls = await Promise.all(
    Array.from({ length: totalParts }, (_, i) => {
      const partNumber = i + 1;
      return getSignedUrl(
        r2,
        new UploadPartCommand({ Bucket: R2_BUCKET, Key: storageKey, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PART_URL_TTL },
      ).then((url) => ({ partNumber, url }));
    }),
  );

  return NextResponse.json({ success: true, urls });
}

// ── Step 3: assemble the object from the uploaded parts ──────────────────────
async function handleComplete(req: NextRequest) {
  const body = await req.json();
  const { storageKey, uploadId, fileName, fileSize, fileType, parts } = body as {
    storageKey: string;
    uploadId: string;
    fileName: string;
    fileSize?: number;
    fileType?: string;
    parts: Array<{ PartNumber: number; ETag: string }>;
  };

  if (!storageKey || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: 'Missing storageKey, uploadId or parts' }, { status: 400 });
  }

  const orderedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

  await r2.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
    UploadId: uploadId,
    MultipartUpload: { Parts: orderedParts },
  }));

  return NextResponse.json({
    success: true,
    storageKey,
    fileName,
    fileSize: fileSize ?? null,
    fileType: fileType ?? 'application/octet-stream',
  });
}

// ── Cleanup: abort a partially uploaded object ───────────────────────────────
async function handleAbort(req: NextRequest) {
  const { storageKey, uploadId } = await req.json();
  if (!storageKey || !uploadId) {
    return NextResponse.json({ error: 'Missing storageKey or uploadId' }, { status: 400 });
  }
  await r2.send(new AbortMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
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
  } catch (error: unknown) {
    console.error('Bulk upload route error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

// ── DELETE: remove a staged object (unmatched / removed file) ─────────────────
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthedProfile();
    if ('error' in auth) return auth.error;

    const { storageKey } = await req.json().catch(() => ({ storageKey: null }));
    if (!storageKey || typeof storageKey !== 'string') {
      return NextResponse.json({ error: 'Missing storageKey' }, { status: 400 });
    }

    // Only allow deleting objects the caller staged (or, for admins, any staged object).
    const owned = storageKey.startsWith(stagingOwnerPrefix(auth.profile.id));
    const isAdminStaged = auth.profile.role === 'admin' && storageKey.startsWith(`${STAGING_PREFIX}/`);
    if (!owned && !isAdminStaged) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // DeleteObject is idempotent on R2 — succeeds whether or not the key exists.
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Bulk upload delete error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
