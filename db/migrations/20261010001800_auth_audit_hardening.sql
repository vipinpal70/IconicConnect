-- Hardens auth_audit_log for real use: who-did-it (actor), structured details, tamper resistance and retention.
--  * actor_id : the admin who performed an action ON another account (user_id = the affected account)
--  * details  : small structured context (e.g. role from/to, failure reason). Never secrets.
--  * append-only: UPDATE/DELETE are rejected by a trigger. Only two things are allowed:
--      - the FK action ON DELETE SET NULL (user_id/actor_id -> NULL when an account is deleted; email is kept)
--      - the retention function below, which opts in with a transaction-local setting.
--    (This stops application bugs and SQL-injection-style edits; a superuser can still bypass it, as always.)

-- migrate:up
ALTER TABLE auth_audit_log
  ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN details  jsonb,
  ADD CONSTRAINT auth_audit_event_ck   CHECK (event ~ '^[a-z][a-z0-9_]{2,63}$'),
  ADD CONSTRAINT auth_audit_ua_ck      CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  ADD CONSTRAINT auth_audit_details_ck CHECK (details IS NULL OR pg_column_size(details) <= 4096);

CREATE INDEX idx_audit_email_time ON auth_audit_log (email, created_at DESC) WHERE email IS NOT NULL;  -- unknown-account probing (user_id is NULL there)
CREATE INDEX idx_audit_event_time ON auth_audit_log (event, created_at DESC);                         -- "all failures / lockouts lately"
CREATE INDEX idx_audit_actor_time ON auth_audit_log (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

CREATE FUNCTION auth_audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
    RETURN OLD;                                   -- retention job only
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.email, NEW.event, NEW.ip, NEW.user_agent, NEW.created_at, NEW.details)
         IS NOT DISTINCT FROM (OLD.id, OLD.email, OLD.event, OLD.ip, OLD.user_agent, OLD.created_at, OLD.details)
     AND (NEW.user_id  IS NOT DISTINCT FROM OLD.user_id  OR NEW.user_id  IS NULL)
     AND (NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id OR NEW.actor_id IS NULL) THEN
    RETURN NEW;                                   -- FK ON DELETE SET NULL (account removed); nothing else may change
  END IF;
  RAISE EXCEPTION 'auth_audit_log is append-only (% rejected)', TG_OP USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_auth_audit_guard BEFORE UPDATE OR DELETE ON auth_audit_log
  FOR EACH ROW EXECUTE FUNCTION auth_audit_log_guard();

-- Retention (default 400 days ≈ 13 months). Run daily from a scheduler; returns the number of rows removed.
CREATE FUNCTION purge_auth_audit_log(retain interval DEFAULT interval '400 days') RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('app.audit_purge', 'on', true);   -- transaction-local
  DELETE FROM auth_audit_log WHERE created_at < now() - retain;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- migrate:down
DROP FUNCTION IF EXISTS purge_auth_audit_log(interval);
DROP TRIGGER IF EXISTS trg_auth_audit_guard ON auth_audit_log;
DROP FUNCTION IF EXISTS auth_audit_log_guard();
DROP INDEX IF EXISTS idx_audit_actor_time;
DROP INDEX IF EXISTS idx_audit_event_time;
DROP INDEX IF EXISTS idx_audit_email_time;
ALTER TABLE auth_audit_log
  DROP CONSTRAINT IF EXISTS auth_audit_details_ck,
  DROP CONSTRAINT IF EXISTS auth_audit_ua_ck,
  DROP CONSTRAINT IF EXISTS auth_audit_event_ck,
  DROP COLUMN IF EXISTS details,
  DROP COLUMN IF EXISTS actor_id;
