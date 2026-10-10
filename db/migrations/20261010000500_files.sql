-- Single R2 object registry (replaces 4 file tables + inline file columns).

-- migrate:up
-- One row per R2 object: scans, previews, reference/hold images, design output, teeth library, chat attachments.
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,   -- owning lab (storage accounting, authz, dup check)
  case_id       uuid REFERENCES cases(id) ON DELETE CASCADE,                -- NULL while uploaded-but-not-yet-attached
  message_id    uuid,                                                       -- FK added after chat_messages (kind = 'chat')
  kind          file_kind   NOT NULL,
  uploaded_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_name     varchar(255) NOT NULL,                                      -- display name as uploaded
  r2_key        text NOT NULL UNIQUE,                                       -- labs/{client_id}/cases/{case_id|_pending}/{kind}/{id}/{safe_name}
  content_type  varchar(150),
  size_bytes    bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),       -- bigint: multi-GB scans
  sha256        char(64),
  note          text,
  status        file_status NOT NULL DEFAULT 'pending',
  upload_id     text,                                                       -- S3 multipart upload id while pending (abort on cleanup)
  created_at    timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz,
  purge_after   timestamptz,                                                -- retention deadline (created_at + R2_RETENTION)
  purged_at     timestamptz,
  deleted_at    timestamptz,                                                -- user-initiated delete (preview / hold images)
  CONSTRAINT files_owner_ck CHECK (case_id IS NULL OR message_id IS NULL)
);

-- migrate:down
DROP TABLE IF EXISTS files;
