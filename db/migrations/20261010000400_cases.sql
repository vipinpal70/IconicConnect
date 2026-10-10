-- Hot narrow cases table + cold case_details, role transition rules, bulk-download ledger.

-- migrate:up
CREATE SEQUENCE cases_number_seq START 1;

CREATE TABLE cases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number                 varchar(50) NOT NULL UNIQUE,          -- <prefix>-<cases_number_seq>, built by the case service
  client_id                   uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  subuser_id                  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by_id               uuid REFERENCES profiles(id) ON DELETE SET NULL,

  category                    varchar(100) NOT NULL,
  case_type                   varchar(100),                          -- promoted from sub_type_data.caseType/caseType1 (price + analytics key)
  sub_type_data               jsonb   NOT NULL DEFAULT '{}'::jsonb,
  teeth                       smallint[] NOT NULL DEFAULT '{}',      -- promoted from sub_type_data.teeth (billing units, duplicate check)
  teeth_count                 integer GENERATED ALWAYS AS (cardinality(teeth)) STORED,

  status                      case_status NOT NULL DEFAULT 'scan_received',
  hold_reason                 text,                                  -- append-accumulated (as today); full history is in activity_logs
  cancel_reason               text,
  feedback_reason             text,
  reject_reason               text,

  designer_id                 uuid REFERENCES profiles(id) ON DELETE SET NULL,
  qc_id                       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  account_manager_id          uuid REFERENCES profiles(id) ON DELETE SET NULL,

  auto_approved               boolean NOT NULL DEFAULT false,
  submitted_to_client_at      timestamptz,                           -- starts the 7-day auto-approve window
  started_at                  timestamptz,                           -- was start_time
  completed_at                timestamptz,                           -- was delivered_time (set on approve)
  tat_minutes                 integer CHECK (tat_minutes IS NULL OR tat_minutes >= 0),
  due_date                    timestamptz,

  client_output_downloaded_at   timestamptz,                         -- cache of case_bulk_downloads (lab-visible)
  internal_files_downloaded_at  timestamptz,                         -- staff-only: strip from every lab response
  preferred_teeth_library     varchar(50) NOT NULL DEFAULT 'default',

  search_text                 text NOT NULL DEFAULT '',              -- lower(case no + category + type + sub-type string values); maintained by trigger
  row_version                 integer NOT NULL DEFAULT 1,            -- optimistic concurrency for concurrent QC/designer updates
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cases_completed_ck CHECK (completed_at IS NULL OR status IN ('approved','delivered'))
);
-- Cold / large / rarely-listed fields. 1:1, fetched only by the case-detail endpoint.
CREATE TABLE case_details (
  case_id             uuid PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  approval_checklist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_note         text,
  client_message      text,                                          -- was client_massage
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Who may move a case from A to B, per role (data-driven mirror of api/cases/[id]/route.ts; see §9).
CREATE TABLE case_status_transitions (
  role          user_role   NOT NULL,
  from_status   case_status NOT NULL,
  to_status     case_status NOT NULL,
  needs_assignment boolean  NOT NULL DEFAULT false,   -- role must be the case's designer/qc
  needs_output_file boolean NOT NULL DEFAULT false,   -- internal_qc requires a design output file
  needs_qc_lead     boolean NOT NULL DEFAULT false,   -- internal_qc requires qc_id set
  PRIMARY KEY (role, from_status, to_status)
);

-- Bulk download tracking (source of truth; cases.*_downloaded_at is its cache).
CREATE TABLE case_bulk_downloads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid NOT NULL REFERENCES cases(id)    ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  scope              bulk_scope  NOT NULL,
  status             bulk_status NOT NULL DEFAULT 'in_progress',
  downloaded_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  downloaded_by_role user_role,
  files_delivered    integer NOT NULL DEFAULT 0,
  bytes_delivered    bigint  NOT NULL DEFAULT 0,
  content_signature  char(64),
  fingerprints       jsonb,
  include            jsonb,
  failure_reason     text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

-- migrate:down
DROP TABLE IF EXISTS case_bulk_downloads;
DROP TABLE IF EXISTS case_status_transitions;
DROP TABLE IF EXISTS case_details;
DROP TABLE IF EXISTS cases;
DROP SEQUENCE IF EXISTS cases_number_seq;
