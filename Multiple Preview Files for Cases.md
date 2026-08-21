Multiple Preview Files for Cases
Context
A case currently supports exactly one design preview file — a single preview_file text column on cases, set either through the ops "Upload Design" dialog or the bulk-confirm flow, and rendered as one tile in CaseDetailView. The ask is to let Admin/Team (admin, designer, qc) attach multiple preview files per case, select/upload them together, see all of them in the case detail preview section, open each individually, and fix mistakes via replace/delete — without breaking cases that already have a single legacy preview.

Clarified scope:

No data migration. cases.preview_file stays untouched. When a case has no rows in the new table but still has the old column set, the API synthesizes one legacy entry so old cases keep rendering correctly.
Both upload entry points get multi-file support: the single-case "Upload Design" dialog and the bulk confirm modal (BulkOutputUploadModal).
Limit: max 5 preview files per case (existing + new combined), max 1GB per individual file — enforced in both entry points, client-side for fast feedback and server-side as the authoritative check.
Replace and delete per preview file, admin/designer/qc only (the same three roles that can currently write previewFile today).
Database
src/db/schema/case.ts — add a new table mirroring the existing caseFiles pattern (lines 208-221):

export const casePreviewFiles = pgTable('case_preview_files', {
id: uuid('id').primaryKey().defaultRandom(),
caseId: uuid('case_id').references(() => cases.id).notNull(),
uploadedBy: uuid('uploaded_by').references(() => profiles.id).notNull(),
fileName: varchar('file_name', { length: 255 }).notNull(),
fileUrl: text('file_url').notNull(),
fileType: varchar('file_type', { length: 100 }),
fileSize: bigint('file_size', { mode: 'number' }),
createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
caseIdIdx: index('case_preview_files_case_id_idx').on(table.caseId),
}))

export type CasePreviewFile = typeof casePreviewFiles.$inferSelect
export type NewCasePreviewFile = typeof casePreviewFiles.$inferInsert
Kept separate from caseFiles deliberately — bulk/confirm/route.ts (lines 143-144) already notes that mixing outputs/previews into caseFiles would wrongly surface them in the client-facing "Case Files" (input scans) list.

Generate + apply via the repo's existing Drizzle workflow: npm run db:generate (creates the next-numbered migration under src/db/migrations/), review the SQL, then npm run db:migrate.

Backend API
New: src/app/api/cases/[id]/preview-files/route.ts (mirrors src/app/api/cases/[id]/files/route.ts's auth/role pattern):

GET — viewable by anyone with access to the case (client/subuser scoped to their own clientId, admin-portal roles unrestricted, same check as files/route.ts lines 130-134). Returns all casePreviewFiles rows for the case, newest first. Fallback: if the result is empty and cases.previewFile is set, return one synthetic entry (id: 'legacy', fileUrl: cases.previewFile, fileName parsed from the URL, fileType: null, createdAt: cases.updatedAt) so old cases render unchanged.
POST — role-gated to admin, qc, designer only (403 otherwise; this excludes client/subuser, matching "Admin and Team"). Body: { fileUrl, fileName, fileType, fileSize } for a file already uploaded via the existing R2 presigned flow (/api/cases/upload, unchanged — reused as-is). Validates fileSize <= 1GB and current row count < 5 before inserting (400 with a clear message otherwise); logs activity via logActivity and calls invalidateCasesCache, same as files/route.ts.
New: src/app/api/cases/[id]/preview-files/[fileId]/route.ts:

DELETE — same admin/qc/designer gate. Deletes the row only. The R2 object is reaped by the existing orphan-cleanup cron once nothing references it (see below) — no synchronous R2 delete needed, consistent with how the rest of the app already handles this. No-ops successfully if fileId === 'legacy' (nothing to delete; a real replacement upload naturally supersedes it since the table becomes non-empty).
src/lib/queue/cleanup-task.ts and src/lib/queue/r2-cleanup-task.ts: both already run a parallel attachmentRows query against caseFiles.fileUrl and protect() each URL so in-use files aren't swept as orphans. Add an identical query against casePreviewFiles.fileUrl in both files, or the new preview files will get deleted by the next cleanup run.

src/app/api/cases/bulk/confirm/route.ts: change ConfirmItem.previewStorageKey/previewFileName (singular, lines 37-38) to previewFiles?: Array<{ storageKey: string; fileName: string; fileType?: string | null; fileSize?: number | null }> (max 5). In the per-item loop (currently lines 127-141), do the same staging→client-namespace CopyObjectCommand/DeleteObjectCommand move for every file in the array. Instead of setting previewFile on the cases update (line 148), insert one row per file into casePreviewFiles (uploadedBy: profile.id) right after the case update succeeds. Enforce the same fileSize <= 1GB / count <= 5 rule per item; a violation fails just that item (existing per-item try/catch at lines 85-199 already isolates failures) rather than the whole batch.

src/app/api/cases/[id]/route.ts: no changes. The previewFile PATCH field (lines 295, 379, 415) stays wired for backward compatibility; nothing writes to it going forward, but old data keeps working.

Frontend — single-case upload dialog (src/app/(ops)/cases/page.tsx)
openDesignUploadDialog (line 547): also fetch /api/cases/${caseId}/preview-files to know the current count, same way it already fetches /files for designUploadExpectedFileName (lines 559-568).
Replace designUploadPreviewFile: File | null (line 387) with designUploadPreviewFiles: File[]. Input (lines 1893-1910) gets multiple; onChange validates each newly picked file with the existing validatePreviewFile (line 601) plus a 1GB size check, appends valid ones, and rejects (toast) anything that would push existingCount + selected.length past 5.
Render the pending selection as a small list with a per-item remove (✕), mirroring AddCaseDialog's multi-file list UI (src/components/AddCaseDialog.tsx lines 608-656).
confirmDesignUpload (line 610): after the output-file upload, loop designUploadPreviewFiles, upload each with uploadFileInChunks and POST the resulting {fileUrl, fileName, fileType, fileSize} to the new /preview-files route (need the full response, not just the URL — widen uploadLocalFile, line 585, or add a sibling that resolves the full object). Drop previewFile from the case PATCH payload (line 646) — new uploads go through the new table exclusively now.
Frontend — bulk modal (src/components/BulkOutputUploadModal.tsx)
Row's singular previewFileName/previewFileType/previewFileSize/previewIsUploading/previewUploadProgress/previewUploadError/previewStorageKey (lines 57-64) become previewFiles: Array<{ tempId, fileName, fileType, fileSize, isUploading, uploadProgress, uploadError, storageKey }> (max 5).
addPreviewFile (line 213) → addPreviewFiles(tempId, files: File[]), validating extension + 1GB per file + the 5-file cap, then uploading each via uploadBulkFile the same way addFiles already loops uploads (lines 180-192). The hidden preview <input> (line 423) gains multiple.
Preview column (lines 492-525) renders the small file list with a remove (✕) per attached preview instead of one filename.
handleConfirm (line 297): send previewFiles: r.previewFiles.map(f => ({ storageKey: f.storageKey, fileName: f.fileName, fileType: f.fileType, fileSize: f.fileSize })) per item instead of the singular fields.
removeRow / resetAndClose (lines 194, 272): purge every previewFiles[].storageKey, not just one.
Frontend — display (src/components/CaseDetailView.tsx)
Add a CasePreviewFile type (mirrors the existing local CaseFile type, lines 80-88) and a useQuery(["case-preview-files", caseId]) fetching the new GET route, staleTime: 30_000 like the sibling case-files query (lines 418-430).
Card visibility gate (line 809): caseRecord.outputFile || previewFiles.length > 0.
Replace the single preview block (lines 841-916) with a .map() over previewFiles: each gets its own card — zip stays a download button, image/html gets its own Show/Hide toggle + inline <img>/<iframe> viewer, reusing getPreviewFileType (lines 24-48) unchanged per file. Swap the single showPreview boolean (line 216) for a Set<string> of expanded file ids.
For chatSide === "admin" viewers, add a small replace icon and delete icon per file:
Replace: pick a file → upload via uploadFileInChunks → POST the new row → DELETE the old row (skip the DELETE call if file.id === 'legacy') → invalidate case-preview-files.
Delete: confirm → DELETE the row → invalidate case-preview-files.
Verification
npm run db:generate then review the generated SQL before npm run db:migrate.
Typecheck the touched files (repo's existing tsc/lint script).
Manual walkthrough via dev server:
As admin/designer, upload 2-3 preview files on one case through the single-case dialog → confirm each renders as its own card in CaseDetailView and opens individually.
Attempt a 6th preview file (client-side rejection) and a file over 1GB (client-side rejection).
Replace one preview file → old one gone, new one shown; delete another → removed, others remain.
Open a case that still only has the legacy preview_file column set (no new-table rows) → confirm it still renders via the fallback.
Bulk modal: attach 2 preview files to one case row, confirm/send → verify both land on the case.
View as a client (chatSide="lab") → previews visible, no replace/delete controls.
