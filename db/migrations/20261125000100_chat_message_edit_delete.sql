-- migrate:up
-- Case chat: the sender can edit or delete a message for 2 minutes after sending it.
-- A deleted message keeps its row (the thread shows "This message was deleted") but not its text.
ALTER TABLE chat_messages
  ADD COLUMN edited_at  timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT chat_messages_deleted_has_no_text CHECK (deleted_at IS NULL OR message_text = '');

-- migrate:down
-- Deleted messages would reappear as empty bubbles: remove them for good first.
DELETE FROM chat_messages WHERE deleted_at IS NOT NULL;
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_deleted_has_no_text,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS edited_at;
