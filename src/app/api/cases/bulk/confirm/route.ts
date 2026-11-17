import { users } from '@/src/db/schema/profile'
import { isValidUploadFileName } from '@/src/lib/security/file-name';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases } from '@/src/db/schema/case';
import { caseDetails } from '@/src/db/schema/case';
import { insertFiles, listByCase } from '@/src/lib/files-repo';
import { files as fileRegistry } from '@/src/db/schema/files';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { and, eq } from 'drizzle-orm';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '@/src/lib/r2';
import { logActivity } from '@/src/lib/activity-log';
import { notifyCaseStatusChanged } from '@/src/lib/notifications/notification-dispatcher';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';
import { invalidateCasesCache, deleteCachedData } from '@/src/lib/redis-cache';
import { getProfileLabName } from '@/src/lib/profile-utils';
import { BULK_UPLOAD_ROLES, BULK_ELIGIBLE_STATUS, bulkAttachDenialReason } from '@/src/lib/bulk-output-eligibility';
import { matchFileToCase, needsNameOverride } from '@/src/lib/bulk-output-matching';
import { caseScopedStorageName } from '@/src/lib/case-file-keys';

/**
 * Bulk confirm — attach each staged output file to its matched case and advance the case.
 *
 * Role-based transition (per product spec):
 *   designer → internal_qc            (send to QC first)
 *   qc/admin → submitted_to_client    (send straight to client review)
 *
 * Per item, server-side and regardless of what the UI sent:
 *   - the user must be allowed to attach outputs to the case (bulk-output-eligibility.ts)
 *   - the file name must match the case (bulk-output-matching.ts) unless the user explicitly
 *     chose "use anyway" (`nameOverride`), which is recorded in the activity log
 *   - files are copied to case-scoped keys (case-file-keys.ts), never over the lab's scan
 *   - DB writes and the status change commit together, only if the case is still in progress;
 *     the staged upload is removed only after that commit, so a failed item can be retried
 *
 * Each item is processed INDEPENDENTLY so one failure never rolls back the others; the
 * per-item outcome is returned in `results`.
 */

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
  /** The user confirmed attaching a file whose name doesn't match the case. */
  nameOverride?: boolean;
  previewFiles?: ConfirmPreviewFile[];
};

class CaseStateChangedError extends Error {}

function objectKey(labName: string, fileName: string) {
  return `${labName}/${fileName}`;
}

function buildFileUrl(labName: string, fileName: string) {
  return `/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`;
}

function copyObject(sourceKey: string, destKey: string) {
  return r2.send(new CopyObjectCommand({
    Bucket: R2_BUCKET,
    CopySource: `${R2_BUCKET}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
    Key: destKey,
  }));
}

function deleteObjectQuietly(key: string, context: string) {
  return r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    .catch((err) => console.error(`[BulkConfirm] ${context} cleanup failed for ${key}:`, err));
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const profile = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1).then(r => r[0]);
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    if (!BULK_UPLOAD_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null) as { items?: ConfirmItem[]; qcId?: string | null } | null;
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }
    if (new Set(items.map((i) => i?.caseId)).size !== items.length) {
      return NextResponse.json({ error: 'Two files are assigned to the same case' }, { status: 400 });
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

    const results: Array<{ caseId: string; ok: boolean; error?: string; needsNameOverride?: boolean }> = [];

    for (const item of items) {
      // Objects copied into the case namespace for this item; removed again if the item fails.
      const copiedKeys: string[] = [];
      try {
        if (!item.caseId || !item.storageKey || !item.fileName) {
          throw new Error('Missing caseId, storageKey or fileName');
        }
        if (!item.storageKey.startsWith(`${STAGING_PREFIX}/`) || item.storageKey.includes('..')) {
          throw new Error('Invalid storageKey');
        }
        // Only confirm objects this user staged (admins may confirm any staged object).
        if (profile.role !== 'admin' && !item.storageKey.startsWith(`${STAGING_PREFIX}/${profile.id}/`)) {
          throw new Error('Forbidden: staged file belongs to another user');
        }
        if (!isValidUploadFileName(item.fileName) || item.fileName.includes('/')) {
          throw new Error('Invalid file name');
        }

        const caseRecord = await db.select().from(cases).where(eq(cases.id, item.caseId)).limit(1).then(r => r[0]);
        if (!caseRecord) throw new Error('Case not found');
        // Re-check server-side — guards against stale UI, concurrent edits and crafted requests.
        const denial = bulkAttachDenialReason(profile, caseRecord);
        if (denial) throw new Error(denial);

        // Same name rule the UI shows; anything weaker than an auto-match needs an explicit override.
        const scanFileNames = (await listByCase(item.caseId, 'scan')).map((f) => f.fileName);
        const matchable = { id: caseRecord.id, caseNumber: caseRecord.caseNumber, scanFileNames };
        const nameOverridden = needsNameOverride(item.fileName, matchable);
        if (nameOverridden && !item.nameOverride) {
          results.push({
            caseId: item.caseId,
            ok: false,
            needsNameOverride: true,
            error: `"${item.fileName}" doesn't match this case's scan file name — confirm "use anyway" to attach it`,
          });
          continue;
        }

        // Designer route must land on a QC: keep the case's existing QC, else use the
        // one picked for this batch. No QC anywhere → refuse (never park a case unowned).
        const finalQcId = targetStatus === 'internal_qc'
          ? (caseRecord.qcId ?? batchQcId)
          : caseRecord.qcId;
        if (targetStatus === 'internal_qc' && !finalQcId) {
          throw new Error('No QC assigned — pick a QC lead before sending to QC');
        }

        // Optional preview files — validated up front, before any R2 object is copied.
        const previewFiles = item.previewFiles ?? [];
        if (previewFiles.length > 0) {
          if (previewFiles.length > MAX_PREVIEW_FILES) {
            throw new Error(`A case can have at most ${MAX_PREVIEW_FILES} preview files`);
          }
          for (const preview of previewFiles) {
            if (!preview.storageKey || !preview.fileName) {
              throw new Error('Missing storageKey or fileName on a preview file');
            }
            if (!preview.storageKey.startsWith(`${STAGING_PREFIX}/`) || preview.storageKey.includes('..')) {
              throw new Error('Invalid previewStorageKey');
            }
            if (profile.role !== 'admin' && !preview.storageKey.startsWith(`${STAGING_PREFIX}/${profile.id}/`)) {
              throw new Error('Forbidden: staged file belongs to another user');
            }
            if (!isValidUploadFileName(preview.fileName) || preview.fileName.includes('/')) {
              throw new Error('Invalid file name');
            }
            if (typeof preview.fileSize === 'number' && preview.fileSize > MAX_PREVIEW_FILE_SIZE) {
              throw new Error(`Preview file "${preview.fileName}" exceeds the 1GB limit`);
            }
          }
          const existingPreviewCount = (await listByCase(item.caseId, 'preview')).length;
          if (existingPreviewCount + previewFiles.length > MAX_PREVIEW_FILES) {
            throw new Error(`A case can have at most ${MAX_PREVIEW_FILES} preview files`);
          }
        }

        const client = await db.select({ labName: profiles.labName, fullName: profiles.fullName, email: users.email }).from(profiles).innerJoin(users, eq(users.id, profiles.id))
          .where(eq(profiles.id, caseRecord.clientId)).limit(1).then(r => r[0]);
        const labName = getProfileLabName(client);

        // Copy staged objects into case-scoped keys inside the lab's namespace (readable by the
        // download proxy, and never colliding with the lab's scan or another case's files).
        const outputStorageName = caseScopedStorageName('output', item.caseId, item.fileName);
        await copyObject(item.storageKey, objectKey(labName, outputStorageName));
        copiedKeys.push(objectKey(labName, outputStorageName));
        const fileUrl = buildFileUrl(labName, outputStorageName);
        const note = item.note?.trim() || null;

        const movedPreviewFiles: Array<{ fileUrl: string; fileName: string; fileType: string | null; fileSize: number | null }> = [];
        for (const preview of previewFiles) {
          const previewStorageName = caseScopedStorageName('preview', item.caseId, preview.fileName);
          await copyObject(preview.storageKey, objectKey(labName, previewStorageName));
          copiedKeys.push(objectKey(labName, previewStorageName));
          movedPreviewFiles.push({
            fileUrl: buildFileUrl(labName, previewStorageName),
            fileName: preview.fileName,
            fileType: preview.fileType ?? null,
            fileSize: preview.fileSize ?? null,
          });
        }

        await db.transaction(async (tx) => {
          // Status first, conditionally: if someone moved the case meanwhile, nothing is written.
          const updated = await tx.update(cases).set({
            status: targetStatus,
            ...(targetStatus === 'internal_qc' ? { qcId: finalQcId } : {}),
            ...(targetStatus === 'submitted_to_client' ? { submittedToClientAt: new Date() } : {}),
            updatedAt: new Date(),
          }).where(and(eq(cases.id, item.caseId), eq(cases.status, BULK_ELIGIBLE_STATUS))).returning({ id: cases.id });
          if (updated.length === 0) throw new CaseStateChangedError('Case changed while uploading — it is no longer in progress');

          // Single design output: replace any previous one.
          await tx.delete(fileRegistry).where(and(eq(fileRegistry.caseId, item.caseId), eq(fileRegistry.kind, 'output')));
          await insertFiles([{
            clientId: caseRecord.clientId, caseId: item.caseId, kind: 'output', uploadedBy: profile.id,
            fileName: item.fileName, fileUrl, fileType: item.fileType ?? null, fileSize: item.fileSize ?? null,
          }], tx);
          await tx.insert(caseDetails).values({ caseId: item.caseId, outputNote: note })
            .onConflictDoUpdate({ target: caseDetails.caseId, set: { outputNote: note } });
          if (movedPreviewFiles.length > 0) {
            await insertFiles(
              movedPreviewFiles.map((p) => ({
                clientId: caseRecord.clientId,
                caseId: item.caseId,
                kind: 'preview' as const,
                uploadedBy: profile.id,
                fileName: p.fileName,
                fileUrl: p.fileUrl,
                fileType: p.fileType,
                fileSize: p.fileSize,
              })),
              tx,
            );
          }
        });

        // Committed: the staged uploads are no longer needed.
        await Promise.all([
          deleteObjectQuietly(item.storageKey, 'staging'),
          ...previewFiles.map((p) => deleteObjectQuietly(p.storageKey, 'staging')),
        ]);

        // ── Post-commit side effects (best-effort, never fail the item) ──
        const match = matchFileToCase(item.fileName, matchable);
        logActivity({
          actor: profile,
          action: 'case.updated',
          caseId: item.caseId,
          details: {
            caseNumber: caseRecord.caseNumber,
            before: { status: caseRecord.status },
            changes: { status: targetStatus, outputFile: fileUrl, outputNote: note, ...(movedPreviewFiles.length > 0 ? { previewFiles: movedPreviewFiles.map((p) => p.fileName) } : {}) },
            bulkUpload: true,
            outputFileName: item.fileName,
            nameMatch: match?.tier ?? 'none',
            ...(nameOverridden ? { nameOverride: true, scanFileNames } : {}),
          },
        }).catch((err) => console.error('[BulkConfirm] activity log failed:', err));

        notifyCaseStatusChanged({
          actorUserId: profile.id,
          targetUserId: caseRecord.clientId,
          caseId: item.caseId,
          caseNumber: caseRecord.caseNumber ?? '',
          status: targetStatus,
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
        // Nothing was committed: drop the copies, keep the staged upload so the user can retry.
        await Promise.all(copiedKeys.map((key) => deleteObjectQuietly(key, 'rollback')));
        if (!(err instanceof CaseStateChangedError)) console.error(`[BulkConfirm] item ${item?.caseId} failed:`, err);
        results.push({ caseId: item?.caseId, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    console.error('Bulk confirm route error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
