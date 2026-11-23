-- migrate:up
-- Support Phase 5 (support-system.md §10, §13): SLA timers and alerts, auto-close, email digests, ratings.

-- One row per priority. Minutes are wall-clock (D5: no business hours yet; the flag is reserved for later).
CREATE TABLE sup_sla_policies (
  priority                sup_priority PRIMARY KEY,
  first_response_minutes  integer NOT NULL CHECK (first_response_minutes BETWEEN 1 AND 43200),
  next_response_minutes   integer NOT NULL CHECK (next_response_minutes BETWEEN 1 AND 43200),
  business_hours          boolean NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sup_sla_policies (priority, first_response_minutes, next_response_minutes) VALUES
  ('urgent',   60,  120),
  ('high',    240,  480),
  ('normal',  480, 1440),
  ('low',    1440, 2880);

-- The reply clock: runs while the lab waits on support, from the first unanswered lab message.
ALTER TABLE sup_tickets
  ADD COLUMN sla_started_at        timestamptz,
  ADD COLUMN reply_due_at          timestamptz,
  ADD COLUMN reply_warn_at         timestamptz,                  -- 80 % of the allowed time
  ADD COLUMN sla_alert_level       smallint NOT NULL DEFAULT 0,  -- 0 none sent, 1 "due soon" sent, 2 "overdue" sent
  ADD COLUMN last_agent_reply_at   timestamptz,                  -- auto-close counts from the latest support reply
  ADD COLUMN auto_close_warned_at  timestamptz,
  ADD CONSTRAINT sup_tickets_sla_alert_level CHECK (sla_alert_level BETWEEN 0 AND 2);

-- SLA sweep (every minute) and overdue counts read only clocks that are running
CREATE INDEX idx_sup_tickets_reply_due ON sup_tickets (reply_due_at) WHERE reply_due_at IS NOT NULL;
-- Auto-close sweep: live conversations waiting on the lab
CREATE INDEX idx_sup_tickets_waiting_on_lab ON sup_tickets (last_agent_reply_at)
  WHERE status = 'live' AND last_public_sender = 'agent';
-- Digest sweep: conversations with recent activity
CREATE INDEX idx_sup_tickets_recent ON sup_tickets (last_message_at);

-- Unread-message emails: when each person was last emailed about a conversation, and up to which message
CREATE TABLE sup_email_digests (
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ticket_id     uuid NOT NULL REFERENCES sup_tickets(id) ON DELETE CASCADE,
  last_seq      bigint NOT NULL,
  last_sent_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, ticket_id)
);
CREATE INDEX idx_sup_email_digests_ticket ON sup_email_digests (ticket_id);

-- ── Backfill existing conversations ──────────────────────────────────────────────────────────────
UPDATE sup_tickets t
SET last_agent_reply_at = (SELECT max(m.created_at) FROM sup_messages m WHERE m.ticket_id = t.id AND m.kind = 'agent');

-- Conversations already waiting on the lab start their auto-close countdown at deploy, not in the past:
-- otherwise every stale (e.g. imported) conversation would be warned and emailed in the first run.
UPDATE sup_tickets SET last_agent_reply_at = now()
WHERE status = 'live' AND last_public_sender = 'agent' AND (last_agent_reply_at IS NULL OR last_agent_reply_at < now());

UPDATE sup_tickets t
SET first_response_due_at = t.created_at + make_interval(mins => p.first_response_minutes)
FROM sup_sla_policies p
WHERE p.priority = t.priority AND t.first_response_due_at IS NULL AND t.source <> 'agent';

-- Open conversations where the lab spoke last: start the clock at their first unanswered message
UPDATE sup_tickets t
SET sla_started_at = coalesce(
  (SELECT min(m.created_at) FROM sup_messages m
    WHERE m.ticket_id = t.id AND m.kind = 'customer' AND m.created_at > coalesce(t.last_agent_reply_at, '-infinity')),
  t.last_message_at)
WHERE t.status <> 'closed' AND t.last_public_sender = 'customer';

UPDATE sup_tickets t
SET reply_due_at  = t.sla_started_at + make_interval(mins => CASE WHEN t.first_responded_at IS NULL THEN p.first_response_minutes ELSE p.next_response_minutes END),
    reply_warn_at = t.sla_started_at + make_interval(secs => 0.8 * 60 * CASE WHEN t.first_responded_at IS NULL THEN p.first_response_minutes ELSE p.next_response_minutes END)
FROM sup_sla_policies p
WHERE p.priority = t.priority AND t.sla_started_at IS NOT NULL;

-- Deadlines that already passed are not announced again (no alert storm on deploy)
UPDATE sup_tickets SET sla_alert_level = CASE WHEN reply_due_at <= now() THEN 2 ELSE 1 END
WHERE reply_warn_at <= now();

-- A running clock always has both deadlines (added after the backfill, which fills them in two steps)
ALTER TABLE sup_tickets ADD CONSTRAINT sup_tickets_sla_consistent CHECK (
  (sla_started_at IS NULL) = (reply_due_at IS NULL) AND (reply_due_at IS NULL) = (reply_warn_at IS NULL)
);

-- migrate:down
DROP TABLE IF EXISTS sup_email_digests;
DROP INDEX IF EXISTS idx_sup_tickets_recent;
DROP INDEX IF EXISTS idx_sup_tickets_waiting_on_lab;
DROP INDEX IF EXISTS idx_sup_tickets_reply_due;
ALTER TABLE sup_tickets
  DROP CONSTRAINT IF EXISTS sup_tickets_sla_consistent,
  DROP CONSTRAINT IF EXISTS sup_tickets_sla_alert_level,
  DROP COLUMN IF EXISTS auto_close_warned_at,
  DROP COLUMN IF EXISTS last_agent_reply_at,
  DROP COLUMN IF EXISTS sla_alert_level,
  DROP COLUMN IF EXISTS reply_warn_at,
  DROP COLUMN IF EXISTS reply_due_at,
  DROP COLUMN IF EXISTS sla_started_at;
DROP TABLE IF EXISTS sup_sla_policies;
