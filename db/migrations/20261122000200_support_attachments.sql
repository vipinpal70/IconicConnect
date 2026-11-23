-- Support system (Phase 2 — attachments). See support-system.md §8.
--
-- Every attachment is an R2 object registered in `files` (kind 'support'), so the orphan sweep keeps it
-- and the retention job marks it purged after 3 months. sup_attachments links that file to a message.
-- Uploads happen before the message is sent: until then message_id is null (and ticket_id too when the
-- file is for a conversation that doesn't exist yet). Unsent uploads are cleared by the upload reaper.

-- migrate:up

-- Safe inside a transaction on PG ≥ 12 as long as the new value isn't used in this same transaction.
ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'support';

ALTER TABLE files ADD COLUMN support_ticket_id uuid REFERENCES sup_tickets(id) ON DELETE CASCADE;
CREATE INDEX idx_files_support_ticket ON files (support_ticket_id) WHERE support_ticket_id IS NOT NULL;

CREATE TYPE sup_attachment_kind AS ENUM ('image', 'video', 'document');

CREATE TABLE sup_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      uuid NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,   -- the lab the file belongs to
  ticket_id    uuid REFERENCES sup_tickets(id) ON DELETE CASCADE,         -- null: for a conversation not yet created
  message_id   uuid REFERENCES sup_messages(id) ON DELETE CASCADE,        -- null: uploaded, not sent yet
  uploaded_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind         sup_attachment_kind NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sup_attachments_sent_has_ticket CHECK (message_id IS NULL OR ticket_id IS NOT NULL)
);

CREATE INDEX idx_sup_attachments_message ON sup_attachments (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_sup_attachments_unsent  ON sup_attachments (created_at) WHERE message_id IS NULL;

-- migrate:down

DROP TABLE IF EXISTS sup_attachments;
DROP TYPE IF EXISTS sup_attachment_kind;
DROP INDEX IF EXISTS idx_files_support_ticket;
ALTER TABLE files DROP COLUMN IF EXISTS support_ticket_id;
-- Postgres cannot drop an enum value; 'support' stays in file_kind (unused) after a rollback.
