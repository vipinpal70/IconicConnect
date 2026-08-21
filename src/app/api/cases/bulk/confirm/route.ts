import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, casePreviewFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, sql } from 'drizzle-orm';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '@/src/lib/r2';
import { logActivity } from '@/src/lib/activity-log';
import { notifyCaseStatusChanged } from '@/src/lib/notifications/notification-dispatcher';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';
import { invalidateCasesCache, deleteCachedData } from '@/src/lib/redis-cache';
import { getProfileLabName } from '@/src/lib/profile-utils';

/**
 * Bulk confirm — attach each staged output file to its matched case and advance the case.
 *
 * Role-based transition (per product spec):
 *   designer → internal_qc            (send to QC first)
 *   qc/admin → submitted_to_client    (send straight to client review)
 *
 * Each item is processed INDEPENDENTLY so one failure never rolls back the others; the
 * per-item outcome is returned in `results`. Independent of the existing case APIs.
 */

const ALLOWED_ROLES = new Set(['designer', 'qc', 'admin']);
const STAGING_PREFIX = 'bulk-staging';
const MAX_PREVIEW_FILES = 5;
const MAX_PREVIEW_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

type ConfirmPreviewFile = {
  storageKey: string;
  fileName: string;
  fileType?: string | null;
  fileSize?: number | null;
};

type ConfirmItem = {
  caseId: string;
  storageKey: string;
  fileName: string;
  fileType?: string | null;
  fileSize?: number | null;
  note?: string | null;
  previewFiles?: ConfirmPreviewFile[];
};

function objectKey(labName: string, fileName: string) {
  return `${labName}/${fileName}`;
}

function buildFileUrl(labName: string, fileName: string) {
  return `/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const profile = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1).then(r => r[0]);
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    if (!ALLOWED_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null) as { items?: ConfirmItem[]; qcId?: string | null } | null;
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    // designer → internal_qc; everyone else allowed here (qc/admin) → submitted_to_client
    const targetStatus: 'internal_qc' | 'submitted_to_client' =
      profile.role === 'designer' ? 'internal_qc' : 'submitted_to_client';

    // Optional batch QC — designers use this to assign a QC to any matched case that
    // doesn't already have one. Validate it points to an active QC before trusting it.
    let batchQcId: string | null = null;
    if (profile.role === 'designer' && body?.qcId) {
      const qcProfile = await db.select({ id: profiles.id, role: profiles.role, status: profiles.status })
        .from(profiles).where(eq(profiles.id, body.qcId)).limit(1).then(r => r[0]);
      if (!qcProfile || qcProfile.role !== 'qc' || qcProfile.status !== 'active') {
        return NextResponse.json({ error: 'Invalid QC selected' }, { status: 400 });
      }
      batchQcId = qcProfile.id;
    }

    const results: Array<{ caseId: string; ok: boolean; error?: string }> = [];

    for (const item of items) {
      try {
        if (!item.caseId || !item.storageKey || !item.fileName) {
          throw new Error('Missing caseId, storageKey or fileName');
        }
        if (!item.storageKey.startsWith(`${STAGING_PREFIX}/`)) {
          throw new Error('Invalid storageKey');
        }

        const caseRecord = await db.select().from(cases).where(eq(cases.id, item.caseId)).limit(1).then(r => r[0]);
        if (!caseRecord) throw new Error('Case not found');
        // Re-check server-side — guards against stale UI / concurrent edits.
        if (caseRecord.status !== 'in_progress') {
          throw new Error(`Case is no longer in progress (status: ${caseRecord.status})`);
        }

        // Designer route must land on a QC: keep the case's existing QC, else use the
        // one picked for this batch. No QC anywhere → refuse (never park a case unowned).
        const finalQcId = targetStatus === 'internal_qc'
          ? (caseRecord.qcId ?? batchQcId)
          : caseRecord.qcId;
        if (targetStatus === 'internal_qc' && !finalQcId) {
          throw new Error('No QC assigned — pick a QC lead before sending to QC');
        }

        // Optional preview files — validated up front, before any R2 object is moved,
        // so a bad attachment fails the item cleanly with nothing left half-moved.
        const previewFiles = item.previewFiles ?? [];
        if (previewFiles.length > 0) {
          if (previewFiles.length > MAX_PREVIEW_FILES) {
            throw new Error(`A case can have at most ${MAX_PREVIEW_FILES} preview files`);
          }
          for (const preview of previewFiles) {
            if (!preview.storageKey || !preview.fileName) {
              throw new Error('Missing storageKey or fileName on a preview file');
            }
            if (!preview.storageKey.startsWith(`${STAGING_PREFIX}/`)) {
              throw new Error('Invalid previewStorageKey');
            }
            if (typeof preview.fileSize === 'number' && preview.fileSize > MAX_PREVIEW_FILE_SIZE) {
              throw new Error(`Preview file "${preview.fileName}" exceeds the 1GB limit`);
            }
          }
          const [{ count: existingPreviewCount }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(casePreviewFiles)
            .where(eq(casePreviewFiles.caseId, item.caseId));
          if (existingPreviewCount + previewFiles.length > MAX_PREVIEW_FILES) {
            throw new Error(`A case can have at most ${MAX_PREVIEW_FILES} preview files`);
          }
        }

        const client = await db.select({ labName: profiles.labName, fullName: profiles.fullName, email: profiles.email }).from(profiles)
          .where(eq(profiles.id, caseRecord.clientId)).limit(1).then(r => r[0]);
        const labName = getProfileLabName(client);

        // Move the staged object into the client-visible namespace so the download proxy
        // (/api/cases/files, which only serves objects under the client's labName) can read it.
        const destKey = objectKey(labName, item.fileName);
        await r2.send(new CopyObjectCommand({
          Bucket: R2_BUCKET,
          CopySource: `${R2_BUCKET}/${item.storageKey.split('/').map(encodeURIComponent).join('/')}`,
          Key: destKey,
        }));
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: item.storageKey }));

        const fileUrl = buildFileUrl(labName, item.fileName);
        const note = item.note?.trim() || null;

        // Same staging→client-namespace move as the output file, one per attached preview.
        const movedPreviewFiles: Array<{ fileUrl: string; fileName: string; fileType: string | null; fileSize: number | null }> = [];
        for (const preview of previewFiles) {
          const previewDestKey = objectKey(labName, preview.fileName);
          await r2.send(new CopyObjectCommand({
            Bucket: R2_BUCKET,
            CopySource: `${R2_BUCKET}/${preview.storageKey.split('/').map(encodeURIComponent).join('/')}`,
            Key: previewDestKey,
          }));
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: preview.storageKey }));
          movedPreviewFiles.push({
            fileUrl: buildFileUrl(labName, preview.fileName),
            fileName: preview.fileName,
            fileType: preview.fileType ?? null,
            fileSize: preview.fileSize ?? null,
          });
        }

        await db.update(cases).set({
          outputFile: fileUrl,
          outputNote: note,
          status: targetStatus,
          ...(targetStatus === 'internal_qc' ? { qcId: finalQcId } : {}),
          ...(targetStatus === 'submitted_to_client' ? { submittedToClientAt: new Date() } : {}),
          updatedAt: new Date(),
        }).where(eq(cases.id, item.caseId));

        if (movedPreviewFiles.length > 0) {
          await db.insert(casePreviewFiles).values(
            movedPreviewFiles.map((p) => ({
              caseId: item.caseId,
              uploadedBy: profile.id,
              fileName: p.fileName,
              fileUrl: p.fileUrl,
              fileType: p.fileType,
              fileSize: p.fileSize,
            }))
          );
        }

        // ── Post-commit side effects (best-effort, never fail the item) ──
        logActivity({
          actor: profile,
          action: 'case.updated',
          caseId: item.caseId,
          details: {
            caseNumber: caseRecord.caseNumber,
            before: { status: caseRecord.status },
            changes: { status: targetStatus, outputFile: fileUrl, outputNote: note, ...(movedPreviewFiles.length > 0 ? { previewFiles: movedPreviewFiles.map((p) => p.fileName) } : {}) },
            bulkUpload: true,
          },
        }).catch((err) => console.error('[BulkConfirm] activity log failed:', err));

        notifyCaseStatusChanged({
          actorUserId: profile.id,
          targetUserId: caseRecord.clientId,
          caseId: item.caseId,
          caseNumber: caseRecord.caseNumber ?? '',
          status: targetStatus,
          serviceType: caseRecord.serviceType,
        }).catch((err) => console.error('[BulkConfirm] client notification failed:', err));

        if (targetStatus === 'internal_qc' && finalQcId) {
          NotificationService.dispatch({
            type: NotificationType.CASE_STATUS_CHANGED,
            actorUserId: profile.id,
            targetUserId: finalQcId,
            entityId: item.caseId,
            entityType: 'case',
            title: 'Case Ready for QC Review',
            message: `Case ${caseRecord.caseNumber} has been submitted for QC review.`,
            link: `/cases/${item.caseId}`,
          }).catch((err) => console.error('[BulkConfirm] QC notification failed:', err));
        }

        await Promise.all([
          invalidateCasesCache(caseRecord.clientId),
          deleteCachedData(`case:detail:${item.caseId}`),
        ]);

        results.push({ caseId: item.caseId, ok: true });
      } catch (err: unknown) {
        console.error(`[BulkConfirm] item ${item?.caseId} failed:`, err);
        results.push({ caseId: item?.caseId, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    console.error('Bulk confirm route error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
