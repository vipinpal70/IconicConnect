import { enqueueCaseCleanup } from '@/src/lib/queue/case-cleanup';
import { findDuplicateBilling } from '@/src/lib/invoice-cases';
import { formatActivityActor } from '@/src/lib/activity-log';
import { caseBulkDownloads } from '@/src/db/schema/bulk-download';
import { isSafeStoredFileUrl } from '@/src/lib/security/safe-url';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseDetails, EDITABLE_STATUSES, NON_DELETABLE_STATUSES } from '@/src/db/schema/case';
import { buildCaseDetail } from '@/src/lib/case-detail';
import { insertFiles, listByCase, pickPerCase, deleteByCases } from '@/src/lib/files-repo';
import { files as fileRegistry } from '@/src/db/schema/files';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq, and, or, like, sql, isNull, inArray } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { logActivity } from '@/src/lib/activity-log';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';
import { notifyCaseStatusChanged } from '@/src/lib/notifications/notification-dispatcher';
import { invalidateCasesCache, getCachedData, setCachedData, deleteCachedData } from '@/src/lib/redis-cache';
import { canTransitionCaseStatus } from '@/src/lib/case-status-transitions';
import { canCancelCase } from '@/src/lib/case-utils';
import type { CaseStatus } from '@/src/lib/case-status-mapping';
import { timelineForClient, isLabRole, stripStaffOnlyCaseFields } from '@/src/lib/case-access';

const CASE_DETAIL_TTL = 300 // 5 minutes
import { chatMessages } from '@/src/db/schema/chat';
import { activityLogs } from '@/src/db/schema/activity-log';

type CaseUpdateData = {
  caseNumber?: string
  dueDate?: Date
  category?: string
  subTypeData?: Record<string, any>
  status?:
  | 'scan_received'
  | 'allocated_to_designer'
  | 'scan_verified'
  | 'scan_not_verified'
  | 'in_progress'
  | 'internal_qc'
  | 'submitted_to_client'
  | 'on_hold'
  | 'client_feedback'
  | 'approved'
  | 'delivered'
  | 'cancelled'
  | 'change_requested'
  | 'client_reject'
  startTime?: Date | null
  deliveredTime?: Date | null
  tat?: number | null
  submittedToClientAt?: Date | null
  autoApproved?: boolean
  designerId?: string | null
  qcId?: string | null
  accountManagerId?: string | null
  holdReason?: string | null
  cancelReason?: string | null
  feedbackReason?: string | null
  rejectReason?: string | null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

function appendCaseReason(existing: string | null | undefined, incoming: string | null | undefined) {
  if (incoming === undefined || incoming === null) return undefined;

  const next = incoming.trim();
  if (!next) return undefined;

  const current = existing?.trim();
  return current ? `${current}\n\n${next}` : next;
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


    const detailCacheKey = `case:detail:${id}`
    const cachedDetail = await getCachedData<Record<string, unknown>>(detailCacheKey)
    if (cachedDetail) {
      // Enforce ownership even on cache hit
      const effectiveClientIdCheck = profile.clientId ?? profile.id;
      if ((profile.role === 'client' || profile.role === 'subuser') && cachedDetail.clientId !== effectiveClientIdCheck) {
        return NextResponse.json({ error: 'Forbidden: You can only view cases from your lab' }, { status: 403 });
      }
      return NextResponse.json({
        data: isLabRole(profile.role) ? stripStaffOnlyCaseFields({ ...cachedDetail, timeline: timelineForClient(cachedDetail.timeline) }, profile.role) : cachedDetail,
      });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Role checks for GET — sub-users share parent client's cases
    const effectiveClientId = profile.clientId ?? profile.id;
    if ((profile.role === 'client' || profile.role === 'subuser') && caseRecord.clientId !== effectiveClientId) {
      return NextResponse.json({ error: 'Forbidden: You can only view cases from your lab' }, { status: 403 });
    }

    const detailPayload = await buildCaseDetail(caseRecord)
    await setCachedData(detailCacheKey, detailPayload, CASE_DETAIL_TTL)
    return NextResponse.json({
      data: isLabRole(profile.role) ? stripStaffOnlyCaseFields({ ...detailPayload, timeline: timelineForClient(detailPayload.timeline) }, profile.role) : detailPayload,
    });
  } catch (error: unknown) {
    console.error('Get case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(
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

    if (caseRecord.status === 'client_reject' && (profile.role === 'client' || profile.role === 'subuser')) {
      return NextResponse.json({ error: 'Forbidden: This case has been rejected and cannot be modified.' }, { status: 400 });
    }

    const body = await req.json();

    // File references written onto a case are later rendered into links/iframes and fetched
    // server-side, so only our own proxy/storage URLs are accepted.
    const fileRefs: unknown[] = [
      ...(typeof body.outputFile === 'string' && body.outputFile ? [body.outputFile] : []),
      ...(typeof body.previewFile === 'string' && body.previewFile ? [body.previewFile] : []),
      ...(Array.isArray(body.holdImages) ? body.holdImages.map((h: { fileUrl?: unknown }) => h?.fileUrl) : []),
    ];
    if (fileRefs.some((u) => !isSafeStoredFileUrl(u))) {
      return NextResponse.json({ error: 'Bad Request: Invalid file reference' }, { status: 400 });
    }
    const updateData: CaseUpdateData = {};
    // Cold fields (case_details) and file references (files registry) are written in the same transaction.
    const detailsUpdate: { outputNote?: string | null; clientMessage?: string | null } = {};
    const fileOps: { outputFile?: string | null; previewFile?: string | null } = {};
    const caseHasOutput = (await pickPerCase([id], 'output', 'latest')).has(id);
    const [detailRow] = await db.select().from(caseDetails).where(eq(caseDetails.caseId, id)).limit(1);

    // Status guard, layered on top of the detailed per-role logic below
    // (not a replacement for it) — rejects statuses outside the Design flow.
    if (body.status) {
      const check = canTransitionCaseStatus({
        currentStatus: caseRecord.status as CaseStatus,
        targetStatus: body.status as CaseStatus,
      })
      if (!check.allowed) {
        return NextResponse.json({ error: `Forbidden: ${check.reason}` }, { status: 403 });
      }
    }

    // Cancellation is authorized by role + current status in one place, so
    // every interface (client, admin, ops/QC/designer) is held to
    // the same rule rather than relying on each portal hiding its button.
    if (body.status === 'cancelled') {
      const cancelCheck = canCancelCase(profile.role, caseRecord.status);
      if (!cancelCheck.allowed) {
        return NextResponse.json({ error: `Forbidden: ${cancelCheck.reason}` }, { status: 403 });
      }
    }

    // Validate and build updates based on role
    if (profile.role === 'client' || profile.role === 'subuser') {
      // Sub-users share parent client's cases — verify ownership via createdBy
      const effectiveClientId = profile.clientId ?? profile.id;
      if (caseRecord.clientId !== effectiveClientId) {
        return NextResponse.json({ error: 'Forbidden: You can only update cases from your lab' }, { status: 403 });
      }

      if (body.status) {
        const current = caseRecord.status;
        const target = body.status;

        // 1. Hold before In Design
        if (target === 'on_hold') {
          const allowedForHold = ['scan_received', 'scan_not_verified', 'scan_verified'];
          if (!allowedForHold.includes(current)) {
            return NextResponse.json({ error: 'Forbidden: Cannot place case on hold after design has started' }, { status: 400 });
          }
        }
        // 2. Resume from hold
        else if (target === 'scan_received' && current === 'on_hold') {
          // Allowed to resume
        }
        // 3. Cancel case — eligibility already enforced above by canCancelCase.
        else if (target === 'cancelled') {
          // Allowed to cancel
        }
        // 4. Approve case (approved) during Client Review
        else if (target === 'approved') {
          if (current !== 'submitted_to_client') {
            return NextResponse.json({ error: 'Forbidden: Cannot approve case unless it is in Client Review status' }, { status: 400 });
          }
        }
        // 5. Request change during Client Review
        else if (target === 'change_requested') {
          if (current !== 'submitted_to_client') {
            return NextResponse.json({ error: 'Forbidden: Cannot request changes unless the case is in Client Review status' }, { status: 400 });
          }
        }
        // 6. Reject case during Client Review
        else if (target === 'client_reject') {
          if (current !== 'submitted_to_client') {
            return NextResponse.json({ error: 'Forbidden: Cannot reject case unless it is in Client Review status' }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: `Forbidden: Client/Subusers cannot transition status from ${current} to ${target}` }, { status: 403 });
        }

        updateData.status = target;
      }

      const nextHoldReason = appendCaseReason(caseRecord.holdReason, body.holdReason);
      if (nextHoldReason !== undefined) updateData.holdReason = nextHoldReason;

      // Cancellation reason is optional, but must be recorded whenever the
      // client supplies one — not just alongside a case-detail edit.
      const nextClientCancelReason = appendCaseReason(caseRecord.cancelReason, body.cancelReason);
      if (nextClientCancelReason !== undefined) updateData.cancelReason = nextClientCancelReason;

      // Allow editing details only if before work starts
      if (body.caseNumber || body.dueDate || body.category || body.subTypeData) {
        if (!EDITABLE_STATUSES.includes(caseRecord.status as typeof EDITABLE_STATUSES[number])) {
          return NextResponse.json({ error: 'Forbidden: Cannot edit case details after work has started' }, { status: 403 });
        }
        if (body.caseNumber) updateData.caseNumber = body.caseNumber;
        if (body.dueDate) updateData.dueDate = new Date(body.dueDate);
        if (body.category) updateData.category = body.category;
        if (body.subTypeData) updateData.subTypeData = body.subTypeData;
      }

      if (body.clientMassage !== undefined) {
        detailsUpdate.clientMessage = body.clientMassage;
      }
    } else if (isValidRoleForType('admin_portal', profile.role)) {
      if (profile.role === 'admin') {
        if (body.caseNumber) updateData.caseNumber = body.caseNumber;
        if (body.dueDate) updateData.dueDate = new Date(body.dueDate);
        if (body.category) updateData.category = body.category;
        if (body.subTypeData) updateData.subTypeData = body.subTypeData;
        if (body.designerId !== undefined) updateData.designerId = body.designerId;
        if (body.qcId !== undefined) updateData.qcId = body.qcId;
        if (body.accountManagerId !== undefined) updateData.accountManagerId = body.accountManagerId;
        if (body.status) {
          if (body.status === 'internal_qc') {
            const hasOutputFile = Boolean(body.outputFile || caseHasOutput);
            if (!hasOutputFile) {
              return NextResponse.json({ error: 'Bad Request: Cannot send to QC without uploading a design output file' }, { status: 400 });
            }
          }
          updateData.status = body.status;
        }
        if (body.outputFile !== undefined) fileOps.outputFile = body.outputFile;
        if (body.previewFile !== undefined) fileOps.previewFile = body.previewFile;

        const nextHoldReason = appendCaseReason(caseRecord.holdReason, body.holdReason);
        if (nextHoldReason !== undefined) updateData.holdReason = nextHoldReason;

        const nextCancelReason = appendCaseReason(caseRecord.cancelReason, body.cancelReason);
        if (nextCancelReason !== undefined) updateData.cancelReason = nextCancelReason;

        const nextFeedbackReason = appendCaseReason(caseRecord.feedbackReason, body.feedbackReason);
        if (nextFeedbackReason !== undefined) updateData.feedbackReason = nextFeedbackReason;

        const nextRejectReason = appendCaseReason(caseRecord.rejectReason, body.rejectReason);
        if (nextRejectReason !== undefined) updateData.rejectReason = nextRejectReason;

        if (body.clientMassage !== undefined) detailsUpdate.clientMessage = body.clientMassage;
      } else if (profile.role === 'qc') {
        const current = caseRecord.status;
        const target = body.status;

        if (body.caseNumber || body.dueDate || body.category || body.subTypeData || body.accountManagerId !== undefined) {
          return NextResponse.json({ error: 'Forbidden: QC cannot modify core case properties or administrative assignments' }, { status: 403 });
        }

        if (body.designerId !== undefined) {
          // QC can assign any designer to any case (including on_hold); assignment is not a status change
          updateData.designerId = body.designerId;
        }

        if (body.qcId !== undefined) {
          updateData.qcId = body.qcId;
        }

        if (target) {
          if (target === 'allocated_to_designer' && (current === 'scan_received' || current === 'scan_verified' || current === 'client_feedback' || current === 'client_reject' || current === 'on_hold')) {
            updateData.status = target;
          } else if (target === 'scan_verified' && current === 'scan_received') {
            updateData.status = target;
          } else if (target === 'in_progress' && (current === 'scan_verified' || current === 'allocated_to_designer' || current === 'client_feedback' || current === 'client_reject') && (caseRecord.designerId === profile.id || updateData.designerId === profile.id)) {
            updateData.status = target;
          } else if (target === 'in_progress' && current === 'internal_qc' && caseRecord.qcId === profile.id) {
            updateData.status = target;
          } else if (target === 'internal_qc' && current === 'in_progress' && (caseRecord.qcId === profile.id || body.qcId === profile.id || caseRecord.designerId === profile.id)) {
            const finalQcId = body.qcId !== undefined ? body.qcId : caseRecord.qcId;
            if (!finalQcId) {
              return NextResponse.json({ error: 'Bad Request: Cannot send to QC without assigning a QC Lead first' }, { status: 400 });
            }
            const hasOutputFile = Boolean(body.outputFile || fileOps.outputFile || caseHasOutput);
            if (!hasOutputFile) {
              return NextResponse.json({ error: 'Bad Request: Cannot send to QC without uploading a design output file first' }, { status: 400 });
            }
            updateData.status = target;
          } else if (target === 'submitted_to_client' && current === 'internal_qc' && caseRecord.qcId === profile.id) {
            updateData.status = target;
          } else if (target === 'internal_qc' && current === 'submitted_to_client' && caseRecord.qcId === profile.id) {
            // Undo: pull an accidentally-submitted case back for another QC pass
            updateData.status = target;
          } else if (target === 'on_hold' && !['on_hold', 'approved', 'delivered', 'cancelled'].includes(current) && (caseRecord.qcId === profile.id || caseRecord.designerId === profile.id)) {
            updateData.status = target;
          } else if (target === 'scan_received' && current === 'on_hold' && (caseRecord.qcId === profile.id || caseRecord.designerId === profile.id)) {
            updateData.status = target;
          } else if (target === 'client_feedback' && current === 'internal_qc' && caseRecord.qcId === profile.id) {
            updateData.status = target;
          } else if (target === 'client_feedback' && current === 'change_requested' && caseRecord.qcId === profile.id) {
            updateData.status = target;
          } else if (target === 'submitted_to_client' && current === 'change_requested' && caseRecord.qcId === profile.id) {
            updateData.status = target;
          } else {
            return NextResponse.json({ error: `Forbidden: QC cannot transition status from ${current} to ${target}` }, { status: 403 });
          }
        }

        const nextHoldReason = appendCaseReason(caseRecord.holdReason, body.holdReason);
        if (nextHoldReason !== undefined) updateData.holdReason = nextHoldReason;

        const nextCancelReason = appendCaseReason(caseRecord.cancelReason, body.cancelReason);
        if (nextCancelReason !== undefined) updateData.cancelReason = nextCancelReason;

        const nextFeedbackReason = appendCaseReason(caseRecord.feedbackReason, body.feedbackReason);
        if (nextFeedbackReason !== undefined) updateData.feedbackReason = nextFeedbackReason;

        const nextRejectReason = appendCaseReason(caseRecord.rejectReason, body.rejectReason);
        if (nextRejectReason !== undefined) updateData.rejectReason = nextRejectReason;

        if (body.outputFile !== undefined) fileOps.outputFile = body.outputFile;
        if (body.previewFile !== undefined) fileOps.previewFile = body.previewFile;
        if (body.outputNote !== undefined) detailsUpdate.outputNote = body.outputNote;
        if (body.clientMassage !== undefined) detailsUpdate.clientMessage = body.clientMassage;
      } else if (profile.role === 'designer') {
        const current = caseRecord.status;
        const target = body.status;

        if (body.caseNumber || body.dueDate || body.category || body.subTypeData || body.accountManagerId !== undefined) {
          return NextResponse.json({ error: 'Forbidden: Designers cannot modify core case properties or administrative assignments' }, { status: 403 });
        }

        const isSelfAllocation =
          !caseRecord.designerId &&
          body.designerId === profile.id &&
          (current === 'scan_received' || current === 'scan_verified') &&
          (target === 'allocated_to_designer' || !target);

        if (isSelfAllocation) {
          updateData.designerId = profile.id;
          // designer assignment is not a lifecycle status change
        } else if (target === 'scan_verified' && current === 'scan_received' && !caseRecord.designerId) {
          updateData.status = target;
        } else {
          if (caseRecord.designerId !== profile.id) {
            return NextResponse.json({ error: 'Forbidden: You can only update cases assigned to you' }, { status: 403 });
          }

          if (body.designerId !== undefined && body.designerId !== profile.id) {
            return NextResponse.json({ error: 'Forbidden: Designers cannot reassign designer ownership' }, { status: 403 });
          }

          if (body.qcId !== undefined) {
            updateData.qcId = body.qcId;
          }

          if (body.outputFile !== undefined) fileOps.outputFile = body.outputFile;
          if (body.previewFile !== undefined) fileOps.previewFile = body.previewFile;
          if (body.outputNote !== undefined) detailsUpdate.outputNote = body.outputNote;

          const nextHoldReason = appendCaseReason(caseRecord.holdReason, body.holdReason);
          if (nextHoldReason !== undefined) updateData.holdReason = nextHoldReason;

          if (target) {
            if (target === 'scan_verified' && current === 'scan_received') {
              updateData.status = target;
            } else if (target === 'in_progress' && (current === 'allocated_to_designer' || current === 'scan_verified' || current === 'client_feedback')) {
              updateData.status = target;
            } else if (target === 'scan_received' && current === 'on_hold' && caseRecord.designerId === profile.id) {
              updateData.status = target;
            } else if (target === 'on_hold' && !['on_hold', 'approved', 'delivered', 'cancelled'].includes(current)) {
              updateData.status = target;
            } else if (target === 'in_progress' && current === 'internal_qc') {
              // Undo: designer pulls their own case back from Internal QC by mistake
              updateData.status = target;
            } else if (target === 'internal_qc' && current === 'submitted_to_client') {
              // Undo: pull an accidentally-submitted case back for another QC pass
              updateData.status = target;
            } else if (target === 'internal_qc' && current === 'in_progress') {
              const finalQcId = body.qcId !== undefined ? body.qcId : caseRecord.qcId;
              if (!finalQcId) {
                return NextResponse.json({ error: 'Bad Request: Cannot send to QC without assigning a QC Lead first' }, { status: 400 });
              }
              const hasOutputFile = Boolean(body.outputFile || fileOps.outputFile || caseHasOutput);
              if (!hasOutputFile) {
                return NextResponse.json({ error: 'Bad Request: Cannot send to QC without uploading a design output file first' }, { status: 400 });
              }
              updateData.status = target;
            } else {
              return NextResponse.json({ error: `Forbidden: Designers cannot transition status from ${current} to ${target}` }, { status: 403 });
            }
          }
        }
      } else if (profile.role === 'account_manager') {
        return NextResponse.json({ error: 'Forbidden: Account Managers have read-only privileges' }, { status: 403 });
      } else {
        return NextResponse.json({ error: 'Forbidden: Unauthorized operational role action' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Forbidden: Unauthorized role' }, { status: 403 });
    }

    // Auto-timestamp: first time work starts
    if (updateData.status === 'in_progress' && !caseRecord.startTime) {
      updateData.startTime = new Date()
    }
    // Auto-timestamp: client approval + compute TAT
    if (updateData.status === 'approved') {
      updateData.deliveredTime = new Date()
      const workStart = updateData.startTime ?? caseRecord.startTime
      if (workStart) {
        updateData.tat = Math.round((updateData.deliveredTime.getTime() - workStart.getTime()) / 60000)
      }
    }
    // Track when case enters client review — starts the 7-day auto-approval window
    if (updateData.status === 'submitted_to_client') {
      updateData.submittedToClientAt = new Date()
    }
    // Undo out of client review — clear the auto-approval window so it doesn't
    // fire against a stale timestamp if the case is resubmitted later
    if (updateData.status === 'internal_qc' && caseRecord.status === 'submitted_to_client') {
      updateData.submittedToClientAt = null
    }

    // Hold images (hold_images-plan.md §4.2/§5): only meaningful alongside an
    // authorized `on_hold` transition, inserted in the same DB transaction as
    // the status update below so the two can never diverge — cancel the Hold
    // dialog before confirming and nothing here ever runs, so nothing needs
    // cleaning up. Authorization is inherited from whichever role-branch above
    // actually set `updateData.status` to 'on_hold' (each already enforces the
    // same admin-or-assigned-QC/designer ownership rule this feature needs —
    // see §1's transition table) — the role check below is defense-in-depth,
    // not the primary gate.
    const MAX_HOLD_FILES = 5;
    const HOLD_IMAGE_UPLOAD_ROLES = new Set(['admin', 'qc', 'designer']);
    type PendingHoldImage = { fileName: string; fileUrl: string; fileType?: string | null; fileSize?: number | null };
    let holdImagesToInsert: PendingHoldImage[] = [];

    if (
      Array.isArray(body.holdImages) &&
      body.holdImages.length > 0 &&
      updateData.status === 'on_hold' &&
      HOLD_IMAGE_UPLOAD_ROLES.has(profile.role)
    ) {
      const rawImages = body.holdImages as unknown[];
      for (const img of rawImages) {
        const candidate = img as Partial<PendingHoldImage> | null;
        if (!candidate || typeof candidate.fileUrl !== 'string' || !candidate.fileUrl || typeof candidate.fileName !== 'string' || !candidate.fileName) {
          return NextResponse.json({ error: 'Bad Request: Each hold image needs a fileUrl and fileName' }, { status: 400 });
        }
      }
      const images = rawImages as PendingHoldImage[];

      // De-dupe within this one request — the same file picked twice in one dialog session.
      const seen = new Set<string>();
      const withinBatch: PendingHoldImage[] = [];
      for (const img of images) {
        const key = `${img.fileName}::${img.fileSize ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        withinBatch.push(img);
      }

      // De-dupe against images already attached to this case (any earlier hold).
      const existingHoldFiles = await listByCase(id, 'hold');
      const existingKeys = new Set(existingHoldFiles.map((f) => `${f.fileName}::${f.fileSize ?? ''}`));

      holdImagesToInsert = withinBatch.filter((img) => !existingKeys.has(`${img.fileName}::${img.fileSize ?? ''}`));

      if (existingHoldFiles.length + holdImagesToInsert.length > MAX_HOLD_FILES) {
        return NextResponse.json({ error: `A case can have at most ${MAX_HOLD_FILES} hold images` }, { status: 400 });
      }
    }

    const hasDetailOps = Object.keys(detailsUpdate).length > 0 || Object.keys(fileOps).length > 0;
    if (Object.keys(updateData).length === 0 && holdImagesToInsert.length === 0 && !hasDetailOps) {
      return NextResponse.json({ error: 'No updates permitted or values provided to set' }, { status: 400 });
    }

    const updatedCase = await db.transaction(async (tx) => {
      const updated = Object.keys(updateData).length > 0
        ? await tx.update(cases).set(updateData).where(eq(cases.id, id)).returning()
        : [caseRecord];

      if (holdImagesToInsert.length > 0) {
        await insertFiles(holdImagesToInsert.map((img) => ({
          clientId: caseRecord.clientId,
          caseId: id,
          kind: 'hold' as const,
          uploadedBy: user.id,
          fileName: img.fileName,
          fileUrl: img.fileUrl,
          fileType: img.fileType ?? null,
          fileSize: img.fileSize ?? null,
        })), tx);
      }

      if (Object.keys(detailsUpdate).length > 0) {
        await tx.insert(caseDetails).values({ caseId: id, ...detailsUpdate })
          .onConflictDoUpdate({ target: caseDetails.caseId, set: detailsUpdate });
      }

      // Single design output / legacy single preview: replace semantics, null clears.
      for (const [kind, value] of [['output', fileOps.outputFile], ['preview', fileOps.previewFile]] as const) {
        if (value === undefined) continue;
        if (kind === 'output') await tx.delete(fileRegistry).where(and(eq(fileRegistry.caseId, id), eq(fileRegistry.kind, 'output')));
        if (value) {
          await insertFiles([{
            clientId: caseRecord.clientId, caseId: id, kind, uploadedBy: user.id,
            fileName: (decodeURIComponent(value.split('fileName=')[1] ?? '') || value.split('/').pop() || kind).split('/').pop()!,
            fileUrl: value,
          }], tx);
        }
      }

      return updated;
    });

    // Dispatch Notifications after successful DB update
    if (updatedCase.length > 0) {
      const uCase = updatedCase[0];
      const actorUserId = profile.id;
      const caseUrl = `/cases/${id}`;

      // Helper to dispatch async safely without blocking the REST response
      const triggerNotification = (type: NotificationType, targetUserId: string, title: string, message: string) => {
        NotificationService.dispatch({
          type,
          actorUserId,
          targetUserId,
          entityId: id,
          entityType: 'case',
          title,
          message,
          link: caseUrl,
        }).catch(err => console.error(`[NotificationTrigger] Failed to dispatch ${type}:`, err));
      };

      // 1. Case Assigned: designerId changed
      if (updateData.designerId !== undefined && updateData.designerId !== caseRecord.designerId) {
        if (updateData.designerId) {
          triggerNotification(
            NotificationType.CASE_ASSIGNED,
            updateData.designerId,
            'New Case Assigned',
            `Case ${uCase.caseNumber} has been assigned to you.`
          );
        }
      }

      // 1.5 Case Assigned for QC: qcId changed
      if (updateData.qcId !== undefined && updateData.qcId !== caseRecord.qcId) {
        if (updateData.qcId) {
          triggerNotification(
            NotificationType.CASE_ASSIGNED,
            updateData.qcId,
            'Case Assigned for QC',
            `You have been assigned as QC for case ${uCase.caseNumber}.`
          );
        }
      }

      // 2. Status Transitions
      if (updateData.status && updateData.status !== caseRecord.status) {
        const status = updateData.status;

        if (profile.role === 'client' || profile.role === 'subuser') {
          // Client-originated status changes should still notify the internal team/designer.
          if (status === 'approved') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_APPROVED,
                caseRecord.designerId,
                'Case Design Approved',
                `Your design for case ${uCase.caseNumber} has been approved by the client.`
              );
            }
          } else if (status === 'in_progress' && caseRecord.status === 'internal_qc') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_REJECTED,
                caseRecord.designerId,
                'Case Design Rejected',
                `Your design for case ${uCase.caseNumber} was rejected in Internal QC. Please review and make modifications.`
              );
            }
          } else if (status === 'client_feedback') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_FEEDBACK,
                caseRecord.designerId,
                'Case Feedback Received',
                `Client has provided feedback on case ${uCase.caseNumber}.`
              );
            }
          } else if (status === 'change_requested') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_FEEDBACK,
                caseRecord.designerId,
                'Case Change Requested',
                `Client has requested changes on case ${uCase.caseNumber}.`
              );
            }
            if (caseRecord.qcId) {
              triggerNotification(
                NotificationType.CASE_FEEDBACK,
                caseRecord.qcId,
                'Case Change Requested',
                `Client has requested changes on case ${uCase.caseNumber}.`
              );
            }
          } else if (status === 'on_hold') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_HOLD,
                caseRecord.designerId,
                'Case Put on Hold',
                `Case ${uCase.caseNumber} has been placed on hold.`
              );
            }
          } else if ((status as string) === 'cancelled') {
            if (caseRecord.designerId) {
              triggerNotification(
                NotificationType.CASE_CANCEL,
                caseRecord.designerId,
                'Case Cancelled',
                `Case ${uCase.caseNumber} has been cancelled.`
              );
            }
          }
        } else {
          notifyCaseStatusChanged({
            actorUserId: actorUserId,
            targetUserId: caseRecord.clientId,
            caseId: id,
            caseNumber: uCase.caseNumber ?? '',
            status: status as string,
          }).catch((err) => console.error('[CaseNotificationTrigger] Failed to dispatch case status notification:', err));

          // Also notify QC if the status is transitioned to internal_qc
          if (status === 'internal_qc' && uCase.qcId) {
            triggerNotification(
              NotificationType.CASE_STATUS_CHANGED,
              uCase.qcId,
              'Case Ready for QC Review',
              `Case ${uCase.caseNumber} has been submitted for QC review.`
            );
          }

        }
      }
    }

    logActivity({
      actor: profile,
      action: 'case.updated',
      caseId: id,
      details: {
        caseNumber: caseRecord.caseNumber,
        before: {
          caseNumber: caseRecord.caseNumber,
          dueDate: caseRecord.dueDate?.toISOString() ?? null,
          category: caseRecord.category,
          subTypeData: caseRecord.subTypeData,
          status: caseRecord.status,
          designerId: caseRecord.designerId,
          qcId: caseRecord.qcId,
          accountManagerId: caseRecord.accountManagerId,
          holdReason: caseRecord.holdReason,
          cancelReason: caseRecord.cancelReason,
          feedbackReason: caseRecord.feedbackReason,
          rejectReason: caseRecord.rejectReason,
          clientMassage: detailRow?.clientMessage ?? null,
        },
        changes: {
          caseNumber: updateData.caseNumber,
          dueDate: updateData.dueDate?.toISOString?.() ?? null,
          category: updateData.category,
          subTypeData: updateData.subTypeData,
          status: updateData.status,
          designerId: updateData.designerId,
          qcId: updateData.qcId,
          accountManagerId: updateData.accountManagerId,
          holdReason: updateData.holdReason,
          cancelReason: updateData.cancelReason,
          feedbackReason: updateData.feedbackReason,
          rejectReason: updateData.rejectReason,
          clientMassage: detailsUpdate.clientMessage,
        },
      },
    }).catch((err) => console.error('[CaseActivityLog] Failed to log activity:', err));

    if (holdImagesToInsert.length > 0) {
      logActivity({
        actor: profile,
        action: 'case.hold_files_uploaded',
        caseId: id,
        details: {
          caseNumber: caseRecord.caseNumber,
          count: holdImagesToInsert.length,
          fileNames: holdImagesToInsert.map((img) => img.fileName),
        },
      }).catch((err) => console.error('[CaseActivityLog] Failed to log hold file upload:', err));
    }

    if (updatedCase.length > 0) {
      await Promise.all([
        invalidateCasesCache(updatedCase[0].clientId),
        deleteCachedData(`case:detail:${id}`),
      ])
    }

    return NextResponse.json({ data: stripStaffOnlyCaseFields(updatedCase[0], profile.role) });
  } catch (error: unknown) {
    console.error('Update case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
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

    // Role checks for DELETE
    if (profile.role === 'subuser') {
      return NextResponse.json({ error: 'Forbidden: Subusers cannot delete cases' }, { status: 403 });
    }

    if (profile.role === 'client') {
      if (caseRecord.clientId !== profile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only delete cases from your lab' }, { status: 403 });
      }
      if (!EDITABLE_STATUSES.includes(caseRecord.status as typeof EDITABLE_STATUSES[number])) {
        return NextResponse.json({ error: 'Forbidden: Cannot delete case once work has started' }, { status: 403 });
      }
    }

    // Billable / in-client-review cases are never deletable (any role): cancel them instead.
    if (NON_DELETABLE_STATUSES.includes(caseRecord.status as typeof NON_DELETABLE_STATUSES[number])) {
      return NextResponse.json({
        error: caseRecord.status === 'submitted_to_client'
          ? 'This case is waiting for the client\'s approval and cannot be deleted. Cancel it instead.'
          : 'Approved and delivered cases are part of billing and cannot be deleted.',
        code: 'case_not_deletable',
        status: caseRecord.status,
      }, { status: 409 });
    }

    // A billed case cannot vanish silently (invoice_cases -> cases is RESTRICT by design). Say so clearly
    // instead of surfacing a raw FK error. One indexed lookup (idx_invoice_cases_case).
    const billedOn = await findDuplicateBilling([id]);
    if (billedOn.length > 0) {
      return NextResponse.json({
        error: `Case ${caseRecord.caseNumber} is on invoice ${billedOn.map((b) => b.invoiceNumber).join(', ')}. Remove it from the invoice before deleting.`,
        code: 'case_on_invoice',
        invoices: billedOn.map((b) => ({ id: b.invoiceId, invoiceNumber: b.invoiceNumber })),
      }, { status: 409 });
    }

    // THE critical path = one short transaction. Everything slow lives in the background job below.
    //  - collect the R2 keys first (the rows disappear with the case);
    //  - keep the case's audit trail (case_id -> NULL) — the other children (files, chat, details, bulk-download
    //    rows) go away through ON DELETE CASCADE, so there is nothing to order or forget;
    //  - the deletion itself is audited, linked to no case (it no longer exists).
    const keys = await db.transaction(async (tx) => {
      const chatIds = tx.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.caseId, id));
      const rows = await tx.select({ k: fileRegistry.r2Key }).from(fileRegistry)
        .where(or(eq(fileRegistry.caseId, id), inArray(fileRegistry.messageId, chatIds)));
      await tx.update(activityLogs).set({ caseId: null }).where(eq(activityLogs.caseId, id));
      await tx.delete(cases).where(eq(cases.id, id));
      await tx.insert(activityLogs).values({
        caseId: null, userId: profile.id, userType: profile.userType, userRole: profile.role,
        actorName: formatActivityActor(profile), action: 'case.deleted', label: `Case ${caseRecord.caseNumber} deleted`,
        clientVisible: false,
        details: {
          caseId: id, caseNumber: caseRecord.caseNumber, category: caseRecord.category, clientId: caseRecord.clientId,
          subuserId: caseRecord.subuserId, status: caseRecord.status, files: rows.length,
        },
      });
      return Array.from(new Set(rows.map((r) => r.k)));
    });

    // Hand the slow part (R2 objects, stale notifications) to the worker and answer right away.
    // enqueueCaseCleanup never throws; if Redis is down the daily orphan sweep reclaims the objects.
    void enqueueCaseCleanup({ caseId: id, caseNumber: caseRecord.caseNumber, keys });

    await Promise.all([
      invalidateCasesCache(caseRecord.clientId),
      deleteCachedData(`case:detail:${id}`),
    ])

    return NextResponse.json({ message: 'Case deleted successfully' });
  } catch (error: unknown) {
    console.error('Delete case error:', error);
    // 23503 = a foreign key still protects a row we did not anticipate: report it, do not leak SQL.
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '23503') return NextResponse.json({ error: 'This case is still referenced by other records and cannot be deleted yet.' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to delete case' }, { status: 500 });
  }
}
