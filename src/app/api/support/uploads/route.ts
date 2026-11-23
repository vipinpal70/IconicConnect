import { NextResponse } from 'next/server'
import { abortUpload, completeUpload, resignUpload, startUpload } from '@/src/lib/support/attachments'
import { enforceLimit, errorResponse, parseBody, requireSupportActor } from '@/src/lib/support/http'
import { uploadRequestSchema } from '@/src/lib/support/validation'

/**
 * POST: attachment uploads (support-system.md §8).
 *   init     → validates the file, starts a multipart upload, returns presigned part URLs
 *   sign     → fresh part URLs for a slow upload
 *   complete → assembles the parts and verifies the stored object's real size
 *   abort    → cancels and removes it
 * File bytes never pass through this server: the browser PUTs parts straight to R2.
 */
export async function POST(req: Request) {
  try {
    const { actor } = await requireSupportActor()
    const request = await parseBody(req, uploadRequestSchema)
    switch (request.action) {
      case 'init': {
        await enforceLimit(actor.id, 'upload')
        const started = await startUpload(actor, request)
        return NextResponse.json(started, { status: 201 })
      }
      case 'sign':
        return NextResponse.json(await resignUpload(actor, request.attachmentId))
      case 'complete':
        return NextResponse.json(await completeUpload(actor, request.attachmentId, request.parts))
      case 'abort':
        await abortUpload(actor, request.attachmentId)
        return new NextResponse(null, { status: 204 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
