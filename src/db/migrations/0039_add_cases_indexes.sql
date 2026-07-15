-- Custom SQL migration file, put your code below! --
CREATE INDEX IF NOT EXISTS "cases_client_id_created_at_idx" ON "cases" ("client_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cases_created_at_idx" ON "cases" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "cases_updated_at_idx" ON "cases" ("updated_at" DESC);
CREATE INDEX IF NOT EXISTS "cases_designer_id_idx" ON "cases" ("designer_id");
CREATE INDEX IF NOT EXISTS "cases_qc_id_idx" ON "cases" ("qc_id");
CREATE INDEX IF NOT EXISTS "case_files_case_id_idx" ON "case_files" ("case_id");