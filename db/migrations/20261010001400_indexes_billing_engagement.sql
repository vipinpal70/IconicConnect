-- Indexes for invoices, offers, tutorials.

-- migrate:up
-- billing ------------------------------------------------------------------------------------------
CREATE INDEX idx_invoices_client_created   ON invoices (client_id, created_at DESC);
CREATE INDEX idx_invoices_created          ON invoices (created_at DESC);                                  -- admin list, badge
CREATE INDEX idx_invoices_status_created   ON invoices (status, created_at DESC);
CREATE INDEX idx_invoices_client_period    ON invoices (client_id, start_date);                            -- monthly billing analytics (client)
CREATE INDEX idx_invoices_period           ON invoices (start_date);                                       -- monthly billing analytics (admin)
CREATE INDEX idx_invoices_unreceived       ON invoices (client_id) WHERE client_paid AND NOT received;     -- admin "payments to confirm"


-- engagement ---------------------------------------------------------------------------------------
CREATE INDEX idx_offers_active_created     ON offers (created_at DESC) WHERE active;                       -- lab offers list + badge
CREATE INDEX idx_offers_valid              ON offers (valid_till) WHERE active;
CREATE INDEX idx_offers_targets            ON offers USING gin (target_client_ids);
CREATE INDEX idx_claims_client             ON offer_claims (client_id);
CREATE INDEX idx_claims_created            ON offer_claims (created_at DESC);                              -- admin badge
CREATE INDEX idx_tutorials_cat_created     ON tutorials (category, created_at DESC);
CREATE INDEX idx_tutorials_created         ON tutorials (created_at DESC);

-- migrate:down
DROP INDEX IF EXISTS idx_tutorials_created;
DROP INDEX IF EXISTS idx_tutorials_cat_created;
DROP INDEX IF EXISTS idx_claims_created;
DROP INDEX IF EXISTS idx_claims_client;
DROP INDEX IF EXISTS idx_offers_targets;
DROP INDEX IF EXISTS idx_offers_valid;
DROP INDEX IF EXISTS idx_offers_active_created;
DROP INDEX IF EXISTS idx_invoices_unreceived;
DROP INDEX IF EXISTS idx_invoices_period;
DROP INDEX IF EXISTS idx_invoices_client_period;
DROP INDEX IF EXISTS idx_invoices_status_created;
DROP INDEX IF EXISTS idx_invoices_created;
DROP INDEX IF EXISTS idx_invoices_client_created;
