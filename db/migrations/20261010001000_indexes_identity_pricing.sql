-- Indexes for profiles/users/audit/pricing.

-- migrate:up
-- profiles ---------------------------------------------------------------------------------------
CREATE INDEX idx_profiles_role_status      ON profiles (user_role, user_status);                          -- staff pickers (designers/QCs/AMs), active-admin fan-out
CREATE INDEX idx_profiles_clients_created  ON profiles (created_at DESC) WHERE user_role = 'client';     -- recent clients, clients list, sidebar "new clients" badge
CREATE INDEX idx_profiles_client_id        ON profiles (client_id) WHERE user_role = 'subuser';           -- sub-user list per lab
CREATE INDEX idx_profiles_created_by       ON profiles (created_by) WHERE created_by IS NOT NULL;         -- FK + "members I created"
CREATE UNIQUE INDEX uq_profiles_lab_name   ON profiles (lower(lab_name)) WHERE user_role = 'client' AND lab_name IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_profiles_lab_trgm         ON profiles USING gin (lower(lab_name)  gin_trgm_ops);        -- case/client search "ilike %term%"
CREATE INDEX idx_profiles_name_trgm        ON profiles USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX idx_users_email_trgm          ON users    USING gin ((email::text) gin_trgm_ops);
CREATE INDEX idx_audit_user_time           ON auth_audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_time_brin           ON auth_audit_log USING brin (created_at);


-- pricing ----------------------------------------------------------------------------------------
CREATE INDEX idx_catalog_active_sort       ON service_catalog (sort_order) WHERE is_active;               -- price-list render order
CREATE INDEX idx_cpl_catalog               ON client_price_list (catalog_item_id);                        -- FK + "who has this item"
-- (client_id, catalog_item_id) UNIQUE already serves "price list for client X"

-- cases: list screens (GET /api/cases) ----------------------------------------------------------
CREATE INDEX idx_cases_created             ON cases (created_at DESC, id DESC);                            -- staff list, keyset paging
CREATE INDEX idx_cases_client_created      ON cases (client_id, created_at DESC, id DESC);                 -- lab/sub-user list
CREATE INDEX idx_cases_status_created      ON cases (status, created_at DESC, id DESC);                    -- staff list filtered by status tab
CREATE INDEX idx_cases_client_status       ON cases (client_id, status, created_at DESC, id DESC);        -- lab list by status + dashboard GROUP BY status
CREATE INDEX idx_cases_category_created    ON cases (category, created_at DESC, id DESC);                  -- category filter
CREATE INDEX idx_cases_designer            ON cases (designer_id, created_at DESC, id DESC) WHERE designer_id IS NOT NULL;   -- "assigned to me" (designer)
CREATE INDEX idx_cases_qc                  ON cases (qc_id, created_at DESC, id DESC)       WHERE qc_id IS NOT NULL;         -- "assigned to me" (QC)
CREATE INDEX idx_cases_am                  ON cases (account_manager_id, created_at DESC)   WHERE account_manager_id IS NOT NULL;
CREATE INDEX idx_cases_subuser             ON cases (subuser_id) WHERE subuser_id IS NOT NULL;
CREATE INDEX idx_cases_search_trgm         ON cases USING gin (search_text gin_trgm_ops);                  -- universal search box (case no, category, type, sub-type values)

-- migrate:down
DROP INDEX IF EXISTS idx_cases_search_trgm;
DROP INDEX IF EXISTS idx_cases_subuser;
DROP INDEX IF EXISTS idx_cases_am;
DROP INDEX IF EXISTS idx_cases_qc;
DROP INDEX IF EXISTS idx_cases_designer;
DROP INDEX IF EXISTS idx_cases_category_created;
DROP INDEX IF EXISTS idx_cases_client_status;
DROP INDEX IF EXISTS idx_cases_status_created;
DROP INDEX IF EXISTS idx_cases_client_created;
DROP INDEX IF EXISTS idx_cases_created;
DROP INDEX IF EXISTS idx_cpl_catalog;
DROP INDEX IF EXISTS idx_catalog_active_sort;
DROP INDEX IF EXISTS idx_audit_time_brin;
DROP INDEX IF EXISTS idx_audit_user_time;
DROP INDEX IF EXISTS idx_users_email_trgm;
DROP INDEX IF EXISTS idx_profiles_name_trgm;
DROP INDEX IF EXISTS idx_profiles_lab_trgm;
DROP INDEX IF EXISTS uq_profiles_lab_name;
DROP INDEX IF EXISTS idx_profiles_created_by;
DROP INDEX IF EXISTS idx_profiles_client_id;
DROP INDEX IF EXISTS idx_profiles_clients_created;
DROP INDEX IF EXISTS idx_profiles_role_status;
