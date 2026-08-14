import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters } from '@/src/db/schema/milling'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/src/lib/r2'

// Admin-only, single-contract-doc-per-centre upload — same 4-action
// (init/sign/complete/abort) multipart shape as
// src/app/api/cases/bulk/upload/route.ts, adapted to persist the resulting
// key onto milling_centers instead of a case/staging record.

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB — plenty for a contract PDF
const PART_URL_TTL = 60 * 60 // 1h
const DOWNLOAD_URL_TTL = 5 * 60 // 5m
const KEY_PREFIX = 'milling-center-docs'

const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.sh', '.lnk', '.scr', '.vbs', '.js',
]

async function handleInit(req: NextRequest, centerId: string) {
  const { searchParams } = new URL(req.url)
  const fileName = searchParams.get('fileName')
  const fileType = searchParams.get('fileType') || 'application/octet-stream'
  const fileSize = Number(searchParams.get('fileSize') || 0)

  if (!fileName) {
    return NextResponse.json({ error: 'File Name is required' }, { status: 400 })
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File size exceeds the 25MB limit' }, { status: 400 })
  }
  const lastDot = fileName.lastIndexOf('.')
  const ext = lastDot !== -1 ? fileName.substring(lastDot).toLowerCase() : ''
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 })
  }

  const key = `${KEY_PREFIX}/${centerId}/${randomUUID()}-${fileName}`
  const created = await r2.send(new CreateMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: fileType,
  }))

  return NextResponse.json({ success: true, uploadId: created.UploadId, key, fileName })
}

async function handleSign(req: NextRequest) {
  const { key, uploadId, totalParts } = await req.json() as {
    key: string
    uploadId: string
    totalParts: number
  }

  if (!key || !uploadId || !totalParts || totalParts < 1) {
    return NextResponse.json({ error: 'Missing key, uploadId or totalParts' }, { status: 400 })
  }

  const urls = await Promise.all(
    Array.from({ length: totalParts }, (_, i) => {
      const partNumber = i + 1
      return getSignedUrl(
        r2,
        new UploadPartCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PART_URL_TTL },
      ).then((url) => ({ partNumber, url }))
    }),
  )

  return NextResponse.json({ success: true, urls })
}

async function handleComplete(req: NextRequest, centerId: string) {
  const { key, uploadId, fileName, parts } = await req.json() as {
    key: string
    uploadId: string
    fileName: string
    parts: Array<{ PartNumber: number; ETag: string }>
  }

  if (!key || !uploadId || !fileName || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: 'Missing key, uploadId, fileName or parts' }, { status: 400 })
  }

  const orderedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)

  await r2.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: orderedParts },
  }))

  await db
    .update(millingCenters)
    .set({ contractDocKey: key, contractDocName: fileName, contractDocUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(millingCenters.id, centerId))

  return NextResponse.json({ success: true, contractDocKey: key, contractDocName: fileName })
}

async function handleAbort(req: NextRequest) {
  const { key, uploadId } = await req.json() as { key: string; uploadId: string }
  if (!key || !uploadId) {
    return NextResponse.json({ error: 'Missing key or uploadId' }, { status: 400 })
  }
  await r2.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }))
  return NextResponse.json({ success: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id: centerId } = await params
    const action = new URL(req.url).searchParams.get('action')

    switch (action) {
      case 'init':
        return await handleInit(req, centerId)
      case 'sign':
        return await handleSign(req)
      case 'complete':
        return await handleComplete(req, centerId)
      case 'abort':
        return await handleAbort(req)
      default:
        return NextResponse.json({ error: 'Unknown or missing action' }, { status: 400 })
    }
  } catch (error: unknown) {
    console.error('[admin/milling/centers/[id]/contract POST]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 })
  }
}

// Short-lived presigned download URL for the centre's contract doc.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id: centerId } = await params
    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, centerId)).limit(1)
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }
    if (!center.contractDocKey) {
      return NextResponse.json({ error: 'No contract document uploaded' }, { status: 404 })
    }

    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: center.contractDocKey }),
      { expiresIn: DOWNLOAD_URL_TTL },
    )

    return NextResponse.json({ url, fileName: center.contractDocName })
  } catch (error: unknown) {
    console.error('[admin/milling/centers/[id]/contract GET]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 })
  }
}