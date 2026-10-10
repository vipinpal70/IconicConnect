-- Indexes for case lists, dashboards and background jobs.

-- migrate:up
-- cases: dashboards, badges, jobs ------------------------------------------------------------------
CREATE INDEX idx_cases_updated             ON cases (updated_at DESC);                                     -- admin "recent cases"
CREATE INDEX idx_cases_client_updated      ON cases (client_id, updated_at DESC);                          -- lab sidebar badge "updated since"
CREATE INDEX idx_cases_designer_open       ON cases (designer_id)
  WHERE designer_id IS NOT NULL AND status NOT IN ('approved','delivered','cancelled','client_reject');     -- designer workload (§1.3 #21)
CREATE INDEX idx_cases_client_open         ON cases (client_id)
  WHERE status NOT IN ('approved','delivered','cancelled','client_reject');                                 -- duplicate-upload check, "active cases" KPI
CREATE INDEX idx_cases_review_clock        ON cases (submitted_to_client_at)
  WHERE status = 'submitted_to_client';                                                                      -- 7-day auto-approve job
CREATE INDEX idx_cases_billable            ON cases (client_id, completed_at)
  WHERE status IN ('approved','delivered');                                                                  -- billing: unbilled completed cases per client/month
CREATE INDEX idx_cases_completed           ON cases (completed_at) WHERE completed_at IS NOT NULL;         -- TAT / delivery analytics

-- migrate:down
DROP INDEX IF EXISTS idx_cases_completed;
DROP INDEX IF EXISTS idx_cases_billable;
DROP INDEX IF EXISTS idx_cases_review_clock;
DROP INDEX IF EXISTS idx_cases_client_open;
DROP INDEX IF EXISTS idx_cases_designer_open;
DROP INDEX IF EXISTS idx_cases_client_updated;
DROP INDEX IF EXISTS idx_cases_updated;
