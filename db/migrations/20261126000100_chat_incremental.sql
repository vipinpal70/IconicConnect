-- migrate:up
-- Case chat loads only what changed since the last look (performance-optimization-notification-plan.md, Phase 0).
-- changed_at moves on every insert, edit and delete; the trigger means no code path can forget it.
ALTER TABLE chat_messages ADD COLUMN changed_at timestamptz;
UPDATE chat_messages SET changed_at = greatest(created_at, coalesce(edited_at, created_at), coalesce(deleted_at, created_at));
ALTER TABLE chat_messages
  ALTER COLUMN changed_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN changed_at SET NOT NULL;

CREATE FUNCTION chat_messages_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.changed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_chat_messages_changed BEFORE UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_touch();

CREATE INDEX idx_chat_case_changed ON chat_messages (case_id, changed_at);

-- migrate:down
DROP INDEX IF EXISTS idx_chat_case_changed;
DROP TRIGGER IF EXISTS trg_chat_messages_changed ON chat_messages;
DROP FUNCTION IF EXISTS chat_messages_touch();
ALTER TABLE chat_messages DROP COLUMN IF EXISTS changed_at;
