-- Cases list paging (GET /api/cases): the list is ordered by (created_at DESC, id DESC) — id breaks
-- ties between cases created in the same instant so pages never repeat or skip rows — and the first
-- uploaded file name is read per case with DISTINCT ON (case_id) ORDER BY created_at.
-- Additive and idempotent; cases/case_files are small, so these build instantly.
CREATE INDEX IF NOT EXISTS "cases_created_at_id_idx" ON "cases" ("created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_client_id_created_at_id_idx" ON "cases" ("client_id", "created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_files_case_id_created_at_idx" ON "case_files" ("case_id", "created_at");
