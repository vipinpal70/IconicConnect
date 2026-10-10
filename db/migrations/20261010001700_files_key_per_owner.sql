-- One R2 object may back several logical files (the same image as a case's scan AND its output, or reused as
-- another case's reference image — the legacy tables allowed this and real data relies on it). UNIQUE(r2_key)
-- would silently drop the second role, so uniqueness moves to (key, kind, owner). Lookups by key stay indexed.

-- migrate:up
ALTER TABLE files DROP CONSTRAINT files_r2_key_key;
CREATE UNIQUE INDEX uq_files_key_kind_owner ON files (r2_key, kind, COALESCE(case_id, message_id));
CREATE INDEX idx_files_r2_key ON files (r2_key);   -- orphan sweep / retention: "is this object still referenced?"

-- migrate:down
DROP INDEX IF EXISTS idx_files_r2_key;
DROP INDEX IF EXISTS uq_files_key_kind_owner;
-- Re-adding UNIQUE(r2_key) fails if shared objects exist; collapse them first (keeps the oldest row per key).
DELETE FROM files f USING files g WHERE f.r2_key = g.r2_key AND (f.created_at, f.id) > (g.created_at, g.id);
ALTER TABLE files ADD CONSTRAINT files_r2_key_key UNIQUE (r2_key);
