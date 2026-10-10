-- Indexes for files registry and bulk downloads.

-- migrate:up
-- files ------------------------------------------------------------------------------------------
CREATE INDEX idx_files_case_kind           ON files (case_id, kind, created_at) WHERE deleted_at IS NULL AND case_id IS NOT NULL;   -- per-case file panels; first scan = DISTINCT ON
CREATE INDEX idx_files_message             ON files (message_id) WHERE message_id IS NOT NULL;             -- chat attachments
CREATE INDEX idx_files_scan_name           ON files (client_id, lower(file_name)) WHERE kind = 'scan' AND deleted_at IS NULL;       -- duplicate-file check
CREATE INDEX idx_files_name_trgm           ON files USING gin (lower(file_name) gin_trgm_ops) WHERE kind = 'scan';                  -- search by file name
CREATE INDEX idx_files_purge               ON files (purge_after) WHERE purged_at IS NULL AND status = 'ready';                     -- retention job
CREATE INDEX idx_files_orphans             ON files (created_at) WHERE case_id IS NULL AND message_id IS NULL;                      -- sweep abandoned/pending uploads
CREATE INDEX idx_files_client_size         ON files (client_id) INCLUDE (size_bytes) WHERE status = 'ready';                        -- per-lab storage usage (index-only)


-- bulk downloads -----------------------------------------------------------------------------------
CREATE INDEX idx_bulk_latest               ON case_bulk_downloads (case_id, scope, completed_at DESC) WHERE status = 'completed';
CREATE INDEX idx_bulk_client_scope         ON case_bulk_downloads (client_id, scope, completed_at DESC) WHERE status = 'completed';
CREATE UNIQUE INDEX uq_bulk_in_flight      ON case_bulk_downloads (case_id, scope) WHERE status = 'in_progress';                    -- at most one running per case+scope
CREATE INDEX idx_bulk_downloader           ON case_bulk_downloads (downloaded_by) WHERE downloaded_by IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_bulk_downloader;
DROP INDEX IF EXISTS uq_bulk_in_flight;
DROP INDEX IF EXISTS idx_bulk_client_scope;
DROP INDEX IF EXISTS idx_bulk_latest;
DROP INDEX IF EXISTS idx_files_client_size;
DROP INDEX IF EXISTS idx_files_orphans;
DROP INDEX IF EXISTS idx_files_purge;
DROP INDEX IF EXISTS idx_files_name_trgm;
DROP INDEX IF EXISTS idx_files_scan_name;
DROP INDEX IF EXISTS idx_files_message;
DROP INDEX IF EXISTS idx_files_case_kind;
