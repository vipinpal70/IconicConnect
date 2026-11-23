-- Support system (Phase 4 — agent tools). See support-system.md §8.
-- Canned replies: shared ones (owner_id NULL, managed by admins) and personal ones (one agent).

-- migrate:up

CREATE TABLE sup_canned_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       varchar(120) NOT NULL CHECK (length(btrim(title)) > 0),
  body        text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  -- Typed after "/" in the composer; lowercase letters, digits and dashes
  shortcut    varchar(40) CHECK (shortcut ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  owner_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,       -- NULL = shared with all agents
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A shortcut is unique among the shared replies, and among one agent's personal replies
CREATE UNIQUE INDEX uq_sup_canned_shortcut ON sup_canned_replies (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut)
  WHERE shortcut IS NOT NULL;
CREATE INDEX idx_sup_canned_owner ON sup_canned_replies (owner_id);

CREATE TRIGGER trg_sup_canned_updated BEFORE UPDATE ON sup_canned_replies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A few shared starting points (editable or deletable by admins)
INSERT INTO sup_canned_replies (title, body, shortcut) VALUES
  ('Greeting', E'Hi {{name}},\n\nThanks for reaching out. I''m looking into this for you now.\n\n{{agent}}', 'hi'),
  ('Need more details', E'Thanks, {{name}}. Could you share the case number and a screenshot of what you see? That will help us solve this faster.', 'details'),
  ('Resolved', E'This should be sorted now, {{name}}. If anything still looks wrong, just reply here and the conversation will reopen.', 'done');

-- migrate:down

DROP TABLE IF EXISTS sup_canned_replies;
