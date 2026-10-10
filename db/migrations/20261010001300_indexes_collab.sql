-- Indexes for chat/activity/notifications/support.

-- migrate:up
-- chat / activity / notifications ---------------------------------------------------------------
CREATE INDEX idx_chat_case_time            ON chat_messages (case_id, created_at DESC);                    -- thread + "latest message" for unread flag
CREATE INDEX idx_chat_sender               ON chat_messages (sender_id);                                   -- FK
CREATE INDEX idx_chat_read_user            ON chat_read_states (user_id);                                  -- FK / "my unread"
CREATE INDEX idx_activity_case_time        ON activity_logs (case_id, action_at) WHERE case_id IS NOT NULL;                         -- case timeline (client_visible filter applied after)
CREATE INDEX idx_activity_user_time        ON activity_logs (user_id, action_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_activity_time_brin        ON activity_logs USING brin (action_at);                        -- global feed / retention, ~free to maintain
CREATE INDEX idx_notif_user_recent         ON notifications (user_id, created_at DESC) WHERE NOT is_dismissed;                      -- bell list
CREATE INDEX idx_notif_user_unread         ON notifications (user_id) WHERE NOT is_read AND NOT is_dismissed;                       -- unread badge (tiny, index-only)
CREATE INDEX idx_notif_entity              ON notifications (entity_type, entity_id) WHERE entity_id IS NOT NULL;                   -- clean-up when entity deleted


-- support / forms ----------------------------------------------------------------------------------
CREATE INDEX idx_tickets_client_created    ON support_tickets (client_id, created_at DESC);
CREATE INDEX idx_tickets_client_updated    ON support_tickets (client_id, updated_at DESC);               -- lab badge "updated since"
CREATE INDEX idx_tickets_created           ON support_tickets (created_at DESC);                           -- admin badge / list
CREATE INDEX idx_tickets_open              ON support_tickets (priority, created_at DESC) WHERE status IN ('open','in_progress','awaiting_client');
CREATE INDEX idx_callbacks_client          ON support_callback_requests (client_id);
CREATE INDEX idx_callbacks_requested       ON support_callback_requests (requested_at DESC);
CREATE UNIQUE INDEX uq_pref_form_name      ON preference_forms (client_id, lower(form_name));              -- also serves "forms for client X"

-- migrate:down
DROP INDEX IF EXISTS uq_pref_form_name;
DROP INDEX IF EXISTS idx_callbacks_requested;
DROP INDEX IF EXISTS idx_callbacks_client;
DROP INDEX IF EXISTS idx_tickets_open;
DROP INDEX IF EXISTS idx_tickets_created;
DROP INDEX IF EXISTS idx_tickets_client_updated;
DROP INDEX IF EXISTS idx_tickets_client_created;
DROP INDEX IF EXISTS idx_notif_entity;
DROP INDEX IF EXISTS idx_notif_user_unread;
DROP INDEX IF EXISTS idx_notif_user_recent;
DROP INDEX IF EXISTS idx_activity_time_brin;
DROP INDEX IF EXISTS idx_activity_user_time;
DROP INDEX IF EXISTS idx_activity_case_time;
DROP INDEX IF EXISTS idx_chat_read_user;
DROP INDEX IF EXISTS idx_chat_sender;
DROP INDEX IF EXISTS idx_chat_case_time;
