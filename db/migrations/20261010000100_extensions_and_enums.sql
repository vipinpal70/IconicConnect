-- Extensions + enum types. Enums come first because every table column references them.

-- migrate:up
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fast ILIKE '%term%'

CREATE TYPE user_type   AS ENUM ('lab_portal', 'admin_portal');
CREATE TYPE user_role   AS ENUM ('client', 'subuser', 'admin', 'qc', 'account_manager', 'designer');
CREATE TYPE user_status AS ENUM ('pending', 'active', 'inactive');
CREATE TYPE plan_status AS ENUM ('trial', 'onboarded');          -- was 'Trial'/'Onboarded'

CREATE TYPE case_status AS ENUM (
  'scan_received','allocated_to_designer','scan_verified','scan_not_verified','in_progress',
  'internal_qc','submitted_to_client','on_hold','client_feedback','approved','delivered',
  'cancelled','change_requested','client_reject'
);

CREATE TYPE unit_type          AS ENUM ('per_tooth', 'per_arch', 'per_case');
CREATE TYPE adjustment_type    AS ENUM ('percent', 'fixed');
CREATE TYPE invoice_status     AS ENUM ('pending', 'paid');
CREATE TYPE file_kind          AS ENUM ('scan', 'preview', 'reference', 'hold', 'output', 'teeth_library', 'chat');
CREATE TYPE file_status        AS ENUM ('pending', 'ready', 'failed', 'purged');
CREATE TYPE ticket_category    AS ENUM ('technical','billing','case_issue','feature_request','account_access','other');
CREATE TYPE ticket_priority    AS ENUM ('low','medium','high','critical');
CREATE TYPE ticket_status      AS ENUM ('open','in_progress','awaiting_client','resolved','closed');
CREATE TYPE bulk_scope         AS ENUM ('client_output', 'internal_files');
CREATE TYPE bulk_status        AS ENUM ('in_progress', 'completed', 'failed', 'reset');

-- migrate:down
-- Extensions are intentionally NOT dropped: other schemas/databases may depend on them.
DROP TYPE IF EXISTS bulk_status;
DROP TYPE IF EXISTS bulk_scope;
DROP TYPE IF EXISTS ticket_status;
DROP TYPE IF EXISTS ticket_priority;
DROP TYPE IF EXISTS ticket_category;
DROP TYPE IF EXISTS file_status;
DROP TYPE IF EXISTS file_kind;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS adjustment_type;
DROP TYPE IF EXISTS unit_type;
DROP TYPE IF EXISTS case_status;
DROP TYPE IF EXISTS plan_status;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS user_type;
