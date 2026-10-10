-- Chat, activity log, notifications, support, preference forms; adds files.message_id FK.

-- migrate:up
CREATE TABLE chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id)    ON DELETE CASCADE,
  sender_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  sender_role   user_role NOT NULL,                  -- snapshot: role at send time
  message_text  text NOT NULL DEFAULT '',            -- attachments are rows in files (message_id)
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE files ADD CONSTRAINT files_message_fk
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;

CREATE TABLE chat_read_states (
  case_id       uuid NOT NULL REFERENCES cases(id)    ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

-- Single audit/timeline table. Replaces cases.timeline (jsonb) and the old activity_logs.
CREATE TABLE activity_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid REFERENCES cases(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_type    user_type,                           -- snapshots: survive role changes / deletion
  actor_role    user_role,
  actor_name    text,
  action        varchar(120) NOT NULL,               -- 'case.created', 'case.status_changed', 'client.approved' …
  label         text,                                -- staff-facing text, frozen at write time
  client_label  text,                                -- lab-facing wording (NULL => use label)
  client_visible boolean NOT NULL DEFAULT false,     -- was timeline[].clientHidden inverted
  details       jsonb,
  action_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          text NOT NULL,                       -- NotificationType values (open set: no migration to add one)
  title         varchar(255) NOT NULL,
  message       text NOT NULL,
  link          text,
  entity_type   text,                                -- 'case' | 'chat' | 'ticket' | 'offer' …
  entity_id     uuid,
  metadata      jsonb,
  is_read       boolean NOT NULL DEFAULT false,
  is_dismissed  boolean NOT NULL DEFAULT false,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Absent row => enabled. No seeding on sign-up, no migration per new event.
CREATE TABLE notification_settings (
  user_id         uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  email_enabled   boolean NOT NULL DEFAULT true,
  in_app_enabled  boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_preferences (
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type      text NOT NULL,                     -- case_assigned, case_feedback, chat_message, offer_created …
  email_enabled   boolean NOT NULL DEFAULT true,
  in_app_enabled  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event_type)
);

CREATE TABLE sidebar_seen_at (
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page_key      varchar(50) NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_key)
);

CREATE SEQUENCE support_ticket_seq START 1;
CREATE TABLE support_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number  varchar(60) NOT NULL UNIQUE DEFAULT ('TKT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('support_ticket_seq')::text, 6, '0')),
  client_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject        varchar(200) NOT NULL,
  message        text NOT NULL,
  category       ticket_category NOT NULL,
  priority       ticket_priority NOT NULL DEFAULT 'medium',
  status         ticket_status   NOT NULL DEFAULT 'open',
  admin_notes    text,
  resolved_at    timestamptz,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_callback_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone         varchar(30),                          -- contact details as given at request time
  email         citext NOT NULL,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preference_forms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  form_name          varchar(150) NOT NULL,
  payload            jsonb NOT NULL,
  is_system_default  boolean NOT NULL DEFAULT false,  -- the form auto-created on client approval
  created_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_message_fk;
DROP TABLE IF EXISTS preference_forms;
DROP TABLE IF EXISTS support_callback_requests;
DROP TABLE IF EXISTS support_tickets;
DROP SEQUENCE IF EXISTS support_ticket_seq;
DROP TABLE IF EXISTS sidebar_seen_at;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS chat_read_states;
DROP TABLE IF EXISTS chat_messages;
