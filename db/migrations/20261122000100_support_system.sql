-- Support system (Phase 1 — foundation). Replaces support_tickets / support_callback_requests.
-- Design: support-system.md. The old tables stay untouched (read-only) until a later migration drops them.
--
-- Conversations (sup_tickets) hold many messages (sup_messages). Customers never see `note` messages.
-- Every change is audited in sup_events. Read positions (sup_reads) drive unread badges and read receipts.

-- migrate:up

CREATE TYPE sup_status        AS ENUM ('new', 'live', 'closed');
CREATE TYPE sup_priority      AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE sup_category      AS ENUM ('technical', 'billing', 'case', 'account', 'feature_request', 'callback', 'other');
CREATE TYPE sup_source        AS ENUM ('page', 'widget', 'agent', 'import');
CREATE TYPE sup_message_kind  AS ENUM ('customer', 'agent', 'note', 'system');
CREATE TYPE sup_side          AS ENUM ('customer', 'agent');
CREATE TYPE sup_close_reason  AS ENUM ('resolved', 'no_reply', 'duplicate', 'spam');
CREATE TYPE sup_event_type    AS ENUM ('created', 'status', 'assignee', 'priority', 'category', 'reopened', 'linked', 'rated', 'auto_closed');

CREATE SEQUENCE sup_ticket_number_seq START 1;
-- One global, strictly increasing message sequence: ordering, SSE replay (Last-Event-ID) and read positions.
CREATE SEQUENCE sup_message_seq START 1;

CREATE TABLE sup_tickets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                  bigint NOT NULL UNIQUE DEFAULT nextval('sup_ticket_number_seq'),
  legacy_number           varchar(60) UNIQUE,                 -- number from the old system, for imported tickets
  client_id               uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by              uuid REFERENCES profiles(id) ON DELETE SET NULL,
  subject                 varchar(200) NOT NULL CHECK (length(btrim(subject)) > 0),
  category                sup_category NOT NULL,
  priority                sup_priority NOT NULL DEFAULT 'normal',
  status                  sup_status   NOT NULL DEFAULT 'new',
  assignee_id             uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source                  sup_source   NOT NULL DEFAULT 'page',
  related_case_id         uuid REFERENCES cases(id) ON DELETE SET NULL,
  linked_ticket_id        uuid REFERENCES sup_tickets(id) ON DELETE SET NULL,
  last_message_at         timestamptz NOT NULL DEFAULT now(),
  last_message_seq        bigint NOT NULL DEFAULT 0,          -- newest public message (what a customer can see)
  last_public_sender      sup_side,
  first_response_due_at   timestamptz,
  first_responded_at      timestamptz,
  closed_at               timestamptz,
  closed_by               uuid REFERENCES profiles(id) ON DELETE SET NULL,
  close_reason            sup_close_reason,
  reopened_count          integer NOT NULL DEFAULT 0,
  csat_score              smallint CHECK (csat_score BETWEEN 1 AND 5),
  csat_comment            text CHECK (length(csat_comment) <= 2000),
  csat_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- A closed conversation always has a close time and reason; an open one never does.
  CONSTRAINT sup_tickets_closed_consistent CHECK (
    (status = 'closed') = (closed_at IS NOT NULL) AND (status = 'closed') = (close_reason IS NOT NULL)
  )
);

CREATE INDEX idx_sup_tickets_client_activity ON sup_tickets (client_id, last_message_at DESC);
CREATE INDEX idx_sup_tickets_inbox           ON sup_tickets (status, priority, last_message_at DESC);
CREATE INDEX idx_sup_tickets_assignee        ON sup_tickets (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_sup_tickets_first_due       ON sup_tickets (first_response_due_at)
  WHERE first_responded_at IS NULL AND status <> 'closed';
CREATE INDEX idx_sup_tickets_subject_fts     ON sup_tickets USING gin (to_tsvector('simple', subject));

CREATE TABLE sup_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES sup_tickets(id) ON DELETE CASCADE,
  seq             bigint NOT NULL UNIQUE DEFAULT nextval('sup_message_seq'),
  kind            sup_message_kind NOT NULL,
  author_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- null: system line, or the author was deleted
  body            text NOT NULL CHECK (length(body) <= 10000),
  client_msg_id   uuid,                                             -- browser-generated, makes sends idempotent
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  CONSTRAINT sup_messages_system_has_no_author CHECK (kind <> 'system' OR author_id IS NULL)
);

CREATE INDEX idx_sup_messages_thread   ON sup_messages (ticket_id, seq);
CREATE UNIQUE INDEX uq_sup_messages_client_msg ON sup_messages (ticket_id, author_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
CREATE INDEX idx_sup_messages_body_fts ON sup_messages USING gin (to_tsvector('simple', body))
  WHERE deleted_at IS NULL;

CREATE TABLE sup_reads (
  ticket_id      uuid NOT NULL REFERENCES sup_tickets(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_seq  bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX idx_sup_reads_user ON sup_reads (user_id);

CREATE TABLE sup_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES sup_tickets(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,      -- null: system
  type        sup_event_type NOT NULL,
  from_value  text,
  to_value    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sup_events_ticket ON sup_events (ticket_id, created_at);

CREATE TRIGGER trg_sup_tickets_updated BEFORE UPDATE ON sup_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Import from the old system ────────────────────────────────────────────────────────────────────
-- Old tickets keep their id (old links and notifications still resolve) and their number as legacy_number.
-- Active tickets stay active; resolved/closed become Closed. The old single message becomes the first
-- customer message; old admin_notes become an internal note (it was always meant to be internal).

INSERT INTO sup_tickets (
  id, legacy_number, client_id, created_by, subject, category, priority, status, source,
  last_message_at, last_public_sender, first_responded_at, closed_at, close_reason, created_at, updated_at
)
SELECT
  t.id,
  t.ticket_number,
  t.client_id,
  COALESCE(t.created_by, t.client_id),
  left(btrim(t.subject), 200),
  (CASE t.category::text
     WHEN 'case_issue'     THEN 'case'
     WHEN 'account_access' THEN 'account'
     ELSE t.category::text
   END)::sup_category,
  (CASE t.priority::text
     WHEN 'critical' THEN 'urgent'
     WHEN 'medium'   THEN 'normal'
     ELSE t.priority::text
   END)::sup_priority,
  (CASE t.status::text
     WHEN 'open'      THEN 'new'
     WHEN 'resolved'  THEN 'closed'
     WHEN 'closed'    THEN 'closed'
     ELSE 'live'
   END)::sup_status,
  'import',
  t.created_at,
  'customer',
  CASE WHEN t.status::text <> 'open' THEN t.updated_at END,
  CASE WHEN t.status::text IN ('resolved', 'closed') THEN COALESCE(t.resolved_at, t.updated_at) END,
  CASE WHEN t.status::text IN ('resolved', 'closed') THEN 'resolved'::sup_close_reason END,
  t.created_at,
  t.updated_at
FROM support_tickets t
WHERE length(btrim(t.subject)) > 0;

INSERT INTO sup_messages (ticket_id, kind, author_id, body, created_at)
SELECT t.id, 'customer', COALESCE(t.created_by, t.client_id), left(t.message, 10000), t.created_at
FROM support_tickets t
JOIN sup_tickets s ON s.id = t.id;

INSERT INTO sup_messages (ticket_id, kind, author_id, body, created_at)
SELECT t.id, 'note', NULL, left('Imported internal note: ' || t.admin_notes, 10000), t.updated_at
FROM support_tickets t
JOIN sup_tickets s ON s.id = t.id
WHERE t.admin_notes IS NOT NULL AND length(btrim(t.admin_notes)) > 0;

-- Callback requests become closed "callback" conversations (history only).
INSERT INTO sup_tickets (
  id, client_id, created_by, subject, category, priority, status, source,
  last_message_at, last_public_sender, closed_at, close_reason, created_at, updated_at
)
SELECT
  c.id, c.client_id, COALESCE(c.created_by, c.client_id), 'Callback request', 'callback', 'normal', 'closed', 'import',
  c.requested_at, 'customer', c.requested_at, 'resolved', c.requested_at, c.requested_at
FROM support_callback_requests c;

INSERT INTO sup_messages (ticket_id, kind, author_id, body, created_at)
SELECT c.id, 'customer', COALESCE(c.created_by, c.client_id),
       'Please call me back.' ||
       COALESCE(E'\nPhone: ' || NULLIF(btrim(c.phone), ''), '') ||
       E'\nEmail: ' || c.email::text,
       c.requested_at
FROM support_callback_requests c;

-- Point each imported ticket at its newest public message, and record its creation in the audit trail.
UPDATE sup_tickets t
SET last_message_seq = m.max_seq
FROM (
  SELECT ticket_id, max(seq) AS max_seq FROM sup_messages WHERE kind IN ('customer', 'agent') GROUP BY ticket_id
) m
WHERE m.ticket_id = t.id;

INSERT INTO sup_events (ticket_id, actor_id, type, to_value, created_at)
SELECT id, created_by, 'created', 'import', created_at FROM sup_tickets WHERE source = 'import';

-- migrate:down

DROP TABLE IF EXISTS sup_events;
DROP TABLE IF EXISTS sup_reads;
DROP TABLE IF EXISTS sup_messages;
DROP TABLE IF EXISTS sup_tickets;
DROP SEQUENCE IF EXISTS sup_message_seq;
DROP SEQUENCE IF EXISTS sup_ticket_number_seq;
DROP TYPE IF EXISTS sup_event_type;
DROP TYPE IF EXISTS sup_close_reason;
DROP TYPE IF EXISTS sup_side;
DROP TYPE IF EXISTS sup_message_kind;
DROP TYPE IF EXISTS sup_source;
DROP TYPE IF EXISTS sup_category;
DROP TYPE IF EXISTS sup_priority;
DROP TYPE IF EXISTS sup_status;
