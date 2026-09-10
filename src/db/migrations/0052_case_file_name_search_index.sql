-- Add Case File Name to the case-list Universal Search.
--
-- The /api/cases search matches a full or partial file name with
-- `lower(case_files.file_name) LIKE '%term%'`. A leading-wildcard LIKE can't
-- use a plain b-tree index, so back it with a trigram GIN index that Postgres
-- can use for infix matches — keeps the search fast across a large number of
-- cases. `case_files_case_id_idx` (added earlier) still covers the correlated
-- `case_id = cases.id` lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_files_file_name_trgm_idx" ON "case_files" USING gin (lower("file_name") gin_trgm_ops);
