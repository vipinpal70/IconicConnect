# IconicConnect — Upgraded Database Schema (Fastify + Auth service + PostgreSQL + Redis + R2)

Source reviewed (read-only): `/home/vipin/Workspace/Projects/IconicConnect`, branch `phase2-designOnly`
(Drizzle schema in `src/db/schema/*`, migrations `0000–0059`, all `src/app/api/**` routes, `src/lib/**`, PM2/queue config).
Target: PostgreSQL 16 (your `Dockerfile` is `postgres:16-alpine`), Redis 7, Cloudflare R2, own auth service (no Supabase).

> **Status:** design document. Nothing in the live project or in this repo's database was changed.
> The DDL in §4 was executed against a scratch database to check it parses and the constraints/indexes build (see §12).

---

## 1. What the current app does (the facts the schema must serve)

### 1.1 Actors

| `user_type`    | `user_role`       | Scope of data                                                                                  | Notes                                                                                                       |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `lab_portal`   | `client`          | own lab (`client_id = own id`)                                                                 | owns cases, price list, invoices, preference forms, sub-users                                               |
| `lab_portal`   | `subuser`         | parent client's data (`client_id = created_by`)                                                | profile row + `sub_users` row; `title` holds Owner/Manager/Coordinator/Technician                           |
| `admin_portal` | `admin`           | everything                                                                                     | only role allowed to edit case core fields, assign people, manage clients/members/invoices/offers/tutorials |
| `admin_portal` | `qc`              | all cases listed; writes only to cases where `qc_id = me` (or assignment)                      | no core-property edits                                                                                      |
| `admin_portal` | `designer`        | all cases listed; writes to cases where `designer_id = me` (may self-claim an unassigned case) | uploads design output                                                                                       |
| `admin_portal` | `account_manager` | all cases listed, **read-only** on cases                                                       | chat participant when assigned                                                                              |

`resolveClientId()` is called in almost every route to map a sub-user to its parent. In the new schema this is a **column** (`profiles.client_id`), not a lookup.

### 1.2 Main data flows

1. **Sign-up** → `profiles` row (`pending`) → admin approves → `active`, price list seeded from `service_catalog`, default preference form created.
2. **Case lifecycle** (14 statuses, enum `case_status`): `scan_received → scan_verified → allocated_to_designer → in_progress → internal_qc → submitted_to_client → approved/delivered`, with side exits `on_hold`, `scan_not_verified`, `client_feedback`, `change_requested`, `client_reject`, `cancelled`. Per-role transition rules live in `api/cases/[id]/route.ts` (§9).
3. **Files**: browser → multipart upload to R2 via presigned parts → case row stores a proxy URL `/api/cases/files?labName=&fileName=`; R2 key = `${labName}/${fileName}`.
4. **Billing**: admin builds an invoice from selected approved cases (price = client price list × teeth/arch/case units), stored as JSON line items + `case_ids` JSON array.
5. **Chat / notifications / support / offers / tutorials / preference forms / bulk download / 3Shape import**.
6. **Background jobs** (BullMQ): 7-day auto-approve of `submitted_to_client`, R2 orphan cleanup, R2 age-retention (3 months), DB cleanup.

### 1.3 Problems found in the current schema (and what this design does about each)

| #   | Finding (where)                                                                                                                                                                                                                                                                                                                                                | Impact                                                                                                                               | Fix in this design                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All timestamps are `timestamp` **without** time zone                                                                                                                                                                                                                                                                                                           | wrong results across DST/servers, cron drift                                                                                         | `timestamptz` everywhere                                                                                                                                                                |
| 2   | `cases.timeline` is a growing `jsonb` rewritten on **every** update                                                                                                                                                                                                                                                                                            | row bloat, TOAST rewrite on each status change, hot-row write amplification                                                          | timeline derived from `activity_logs` (`client_visible`, `client_label` columns)                                                                                                        |
| 3   | `invoices.case_ids jsonb`                                                                                                                                                                                                                                                                                                                                      | cannot index, cannot tell which invoices contain a case, cascade/delete logic done by hand                                           | `invoice_cases` join table; a case already on another invoice gives a **warning** (not a block)                                                                                         |
| 4   | Invoice number = `SELECT … LIKE 'Inv_2026_%' ORDER BY … LIMIT 1` then +1                                                                                                                                                                                                                                                                                       | race → duplicate numbers under concurrency                                                                                           | `invoice_counters` + `next_invoice_number()` (atomic upsert)                                                                                                                            |
| 5   | Four near-identical file tables (`case_files`, `case_preview_files`, `case_reference_files`, `case_hold_files`) + `cases.output_file`, `preview_file`, `teeth_library_file_url` + chat attachment columns                                                                                                                                                      | same code 5×, no uniform retention/purge/size accounting                                                                             | one `files` registry with `kind` enum; API always filters by `kind` so previews never leak into "Case Files"                                                                            |
| 6   | R2 key `${labName}/${fileName}`                                                                                                                                                                                                                                                                                                                                | same name overwrites; renaming a lab orphans files; lab name must be unique across _all_ users (sign-up enforces it for this reason) | immutable key `labs/{client_id}/cases/{case_id}/{kind}/{file_id}/{name}`                                                                                                                |
| 7   | Retention job deletes every R2 object older than 3 months while DB rows keep the URL                                                                                                                                                                                                                                                                           | broken downloads with no signal to UI                                                                                                | `files.purge_after` / `purged_at` / `status='purged'`; UI can show "expired"                                                                                                            |
| 8   | `notification_preferences` has 36 boolean columns (one pair per event)                                                                                                                                                                                                                                                                                         | every new event = migration                                                                                                          | rows per `(user_id, event_type)`; missing row = default on                                                                                                                              |
| 9   | `profiles.password` column (legacy plaintext sub-user passwords; nulled by migration 0056)                                                                                                                                                                                                                                                                     | credential leak risk                                                                                                                 | removed; credentials only in `users.password_hash`                                                                                                                                      |
| 10  | `profiles.email` duplicates auth email; `email_idx` duplicates the unique index                                                                                                                                                                                                                                                                                | wasted index, drift risk                                                                                                             | email lives once in `users.email` (`citext`, case-insensitive unique)                                                                                                                   |
| 11  | `sub_users` table is just `(profile_id, client_id)` and `id = profile_id` (redundant)                                                                                                                                                                                                                                                                          | an extra join/lookup per request                                                                                                     | `profiles.client_id` (self for client, parent for sub-user, `NULL` for staff)                                                                                                           |
| 12  | `cases.created_by` is `varchar(255)` holding a display name                                                                                                                                                                                                                                                                                                    | not joinable, stale on rename                                                                                                        | `created_by_id uuid`                                                                                                                                                                    |
| 13  | `cases.client_massage` (typo)                                                                                                                                                                                                                                                                                                                                  |                                                                                                                                      | `case_details.client_message`                                                                                                                                                           |
| 14  | `chat_messages.file_size text`, `sender_name`/`sender_role` as free text                                                                                                                                                                                                                                                                                       | no type safety; stale names                                                                                                          | `bigint`, role enum, name via join                                                                                                                                                      |
| 15  | Offers: `start_date`/`valid_till` are `varchar(20)`; targets are JSON arrays                                                                                                                                                                                                                                                                                   | cannot compare/index dates or targets                                                                                                | `date` columns, `uuid[]`/`text[]` + GIN                                                                                                                                                 |
| 16  | `profiles.full_name varchar(100)`/`title varchar(50)` but sign-up clips to 150/100                                                                                                                                                                                                                                                                             | silent truncation or insert errors                                                                                                   | widths aligned to what the API accepts                                                                                                                                                  |
| 17  | Case list search does `sub_type_data::text ILIKE '%…%'` (sequential scan of a JSON cast)                                                                                                                                                                                                                                                                       | list search is O(table)                                                                                                              | `cases.search_text` (trigger-maintained) + trigram GIN; file-name and client-name search resolve ids through trigram indexes on `files` / `profiles`, as the current route already does |
| 18  | Redundant indexes: `cases_created_at_idx` (⊂ `created_at,id`), `cases_client_id_created_at_idx` (⊂ `client_id,created_at,id`), `cases_updated_at_idx`, `chat_messages_case_id_idx` (⊂ composite), `notifications_read_idx`/`_type_idx`/`_created_at_idx` (low selectivity), `offers_sponsored_idx`, `tutorials_youtube_video_id_idx`, `case_files_case_id_idx` | each costs write time and RAM                                                                                                        | dropped / replaced by composites and partial indexes (§5)                                                                                                                               |
| 19  | Admin dashboard = 7 separate `COUNT(*)` queries + a LEFT JOIN designer-workload; billing page loads **all** approved cases and prices them in Node; analytics aggregate raw `cases` per request                                                                                                                                                                | slow as data grows                                                                                                                   | one `GROUP BY status` query, partial indexes, two materialized rollups (§6)                                                                                                             |
| 20  | `monthly billing` grouped in JS by `toLocaleString`                                                                                                                                                                                                                                                                                                            |                                                                                                                                      | SQL grouping on `invoices.start_date` / rollup                                                                                                                                          |
| 21  | Designer workload counts cases `NOT IN ('approved','delivered')` – `cancelled` and `client_reject` still count as load                                                                                                                                                                                                                                         | inflated workload                                                                                                                    | partial index + query use a single "finished" set (**behaviour change, flagged in §11**)                                                                                                |
| 22  | `preference_forms.id` has no default (client generates it)                                                                                                                                                                                                                                                                                                     |                                                                                                                                      | `gen_random_uuid()` default; `(client_id, lower(form_name))` unique                                                                                                                     |
| 23  | `pricing_crown_bridge` / `pricing_implants` + `get_case_price` RPC (Supabase migration) still read by `/api/service-pricing`                                                                                                                                                                                                                                   | second, older pricing model                                                                                                          | replaced by `service_catalog` + `client_price_list`; drop after that endpoint is ported                                                                                                 |
| 24  | Session cap is 7 h (`session-limit.ts`), but the new auth service defaults to 7 d idle / 30 d absolute                                                                                                                                                                                                                                                         | policy regression                                                                                                                    | Redis session TTL set to **7 h absolute** to match current behaviour (§7) — change deliberately if wanted                                                                               |

---

## 2. Design principles

1. **Hot path = one indexed lookup.** Every list/dashboard query in §5 has a named index that matches its `WHERE` + `ORDER BY`, so Postgres can stop after `LIMIT` rows (keyset-friendly `(created_at DESC, id DESC)`).
2. **Narrow hot tables.** `cases` keeps only columns the list screens read; cold/large fields live in `case_details`, history in `activity_logs`, blobs in R2.
3. **Partial indexes** for the small "active" slice (open cases, unread notifications, pending uploads) instead of indexing every row.
4. **Constraints in the database**, not only in route code: role/type consistency, money arithmetic, one-in-flight-download.
5. **No cross-user access by construction**: every lab query is `WHERE client_id = $session.client_id`; staff queries are role-gated in the service layer (§9). RLS is intentionally not used — the app connects as one DB role and the auth service is the authority.
6. **Rollups, not repeated scans**, for analytics; Redis for read-through caches with O(1) invalidation (§7).
7. **UUID primary keys** (`gen_random_uuid()`, built in on PG ≥ 13). If you move to PG 18, switch defaults to `uuidv7()` for better index locality — no other change needed.

---

## 3. Extensions & enums

```sql
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
```

---

## 4. Tables (executable DDL)

Run in this order. Group headers match the table of contents:
**A** identity · **B** pricing · **C** cases · **D** files · **E** collaboration · **F** billing · **G** engagement · **H** helpers.

### A. Identity & access

```sql
-- A1. Credentials only. Hot, tiny, touched by the auth service.
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,                 -- single source of truth for email
  password_hash       text   NOT NULL,                        -- argon2id ($argon2id$…); legacy bcrypt ($2…) allowed until first login, then re-hashed
  email_verified_at   timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- A2. Business identity, 1:1 with users.
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_type     user_type   NOT NULL,
  user_role     user_role   NOT NULL,
  user_status   user_status NOT NULL DEFAULT 'pending',
  plan_status   plan_status,                                   -- lab_portal only
  -- effective lab: client -> itself, subuser -> parent client, staff -> NULL
  client_id     uuid REFERENCES profiles(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- who created this sub-user / staff member
  full_name     varchar(150),
  title         varchar(100),                                  -- sub-user sub-role: Owner/Manager/Coordinator/Technician
  phone         varchar(30),
  lab_name      varchar(150),
  postal_code   varchar(20),
  city          varchar(100),
  state         varchar(100),
  country       varchar(100),
  onboarded_at  timestamptz,
  deleted_at    timestamptz,                                   -- soft delete; hard delete is done by the explicit delete-client service
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_type_role_ck CHECK (
       (user_type = 'lab_portal'   AND user_role IN ('client','subuser'))
    OR (user_type = 'admin_portal' AND user_role IN ('admin','qc','account_manager','designer'))
  ),
  CONSTRAINT profiles_client_id_ck CHECK (
       (user_role = 'client'  AND client_id = id)
    OR (user_role = 'subuser' AND client_id IS NOT NULL AND client_id <> id)
    OR (user_type = 'admin_portal' AND client_id IS NULL)
  ),
  CONSTRAINT profiles_plan_ck CHECK (plan_status IS NULL OR user_type = 'lab_portal')
);

-- A3. Security audit trail (sign-in, lockout, reset, role change). Append-only.
CREATE TABLE auth_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  email       citext,
  event       text NOT NULL,            -- signin_ok | signin_fail | locked | signout | pw_reset_requested | pw_reset_done | role_changed …
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Sessions, lockout counters, reset tokens and CSRF tokens are **not** in Postgres — they are Redis (§7).

### B. Pricing

```sql
CREATE TABLE service_catalog (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       varchar(100) NOT NULL,
  sub_category   varchar(100) NOT NULL,
  unit_type      unit_type    NOT NULL,
  default_price  numeric(12,2) NOT NULL CHECK (default_price >= 0),
  sort_order     integer      NOT NULL DEFAULT 0,
  is_active      boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT service_catalog_cat_sub_uq UNIQUE (category, sub_category)
);

CREATE TABLE client_price_list (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  catalog_item_id  uuid NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  price            numeric(12,2) NOT NULL CHECK (price >= 0),
  notes            text,
  is_enabled       boolean NOT NULL DEFAULT true,   -- available only if catalog.is_active AND is_enabled
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_price_list_uq UNIQUE (client_id, catalog_item_id)
);

-- Status presentation + flow metadata, so SQL (dashboards, reports) can join instead of repeating CASE lists.
CREATE TABLE case_status_meta (
  status           case_status PRIMARY KEY,
  admin_label      text NOT NULL,
  client_label     text NOT NULL,
  lifecycle_step   text NOT NULL,           -- Submitted | In Validation | In Design | Internal QC | Pending Client Approval | Completed
  step_order       smallint NOT NULL,
  is_finished      boolean NOT NULL,        -- true: approved, delivered, cancelled, client_reject  (no more work)
  is_billable      boolean NOT NULL DEFAULT false   -- approved, delivered
);
```

### C. Cases

```sql
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
```

```sql
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
```

### D. Files (R2 object registry)

```sql
-- One row per R2 object: scans, previews, reference/hold images, design output, teeth library, chat attachments.
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,   -- owning lab (storage accounting, authz, dup check)
  case_id       uuid REFERENCES cases(id) ON DELETE CASCADE,                -- NULL while uploaded-but-not-yet-attached
  message_id    uuid,                                                       -- FK added after chat_messages (kind = 'chat')
  kind          file_kind   NOT NULL,
  uploaded_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_name     varchar(255) NOT NULL,                                      -- display name as uploaded
  r2_key        text NOT NULL UNIQUE,                                       -- labs/{client_id}/cases/{case_id|_pending}/{kind}/{id}/{safe_name}
  content_type  varchar(150),
  size_bytes    bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),       -- bigint: multi-GB scans
  sha256        char(64),
  note          text,
  status        file_status NOT NULL DEFAULT 'pending',
  upload_id     text,                                                       -- S3 multipart upload id while pending (abort on cleanup)
  created_at    timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz,
  purge_after   timestamptz,                                                -- retention deadline (created_at + R2_RETENTION)
  purged_at     timestamptz,
  deleted_at    timestamptz,                                                -- user-initiated delete (preview / hold images)
  CONSTRAINT files_owner_ck CHECK (case_id IS NULL OR message_id IS NULL)
);
```

### E. Collaboration

```sql
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
```

### F. Billing

```sql
CREATE TABLE invoice_counters (
  year      integer PRIMARY KEY,
  last_seq  integer NOT NULL
);

-- Atomic: concurrent callers can never get the same number.
CREATE FUNCTION next_invoice_number() RETURNS text LANGUAGE sql AS $$
  WITH n AS (
    INSERT INTO invoice_counters(year, last_seq)
    VALUES (extract(year FROM now())::int, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = invoice_counters.last_seq + 1
    RETURNING year, last_seq
  )
  SELECT 'Inv_' || year || '_' || lpad(last_seq::text, 4, '0') FROM n;
$$;

CREATE TABLE invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number            varchar(50) NOT NULL UNIQUE DEFAULT next_invoice_number(),
  client_id                 uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  start_date                date NOT NULL,
  end_date                  date NOT NULL,
  items                     jsonb NOT NULL DEFAULT '[]'::jsonb,         -- frozen line-item snapshot (prices must not change retroactively)
  subtotal                  numeric(12,2) NOT NULL DEFAULT 0,
  tax_type                  adjustment_type NOT NULL DEFAULT 'percent',
  tax_value                 numeric(12,2)   NOT NULL DEFAULT 0,
  tax_amount                numeric(12,2)   NOT NULL DEFAULT 0,
  discount_type             adjustment_type NOT NULL DEFAULT 'percent',
  discount_value            numeric(12,2)   NOT NULL DEFAULT 0,
  discount_amount           numeric(12,2)   NOT NULL DEFAULT 0,
  extra_charges_type        adjustment_type NOT NULL DEFAULT 'percent',
  extra_charges_value       numeric(12,2)   NOT NULL DEFAULT 0,
  extra_charges_amount      numeric(12,2)   NOT NULL DEFAULT 0,
  total                     numeric(12,2)   NOT NULL DEFAULT 0,
  status                    invoice_status  NOT NULL DEFAULT 'pending',
  remarks                   text,
  terms_of_payment          varchar(100)    DEFAULT '7 Days',
  client_paid               boolean NOT NULL DEFAULT false,
  client_payment_date       date,
  received                  boolean NOT NULL DEFAULT false,             -- admin confirmed receipt
  received_confirmation_id  varchar(100),
  received_on               date,
  created_by                uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_period_ck CHECK (end_date >= start_date),
  CONSTRAINT invoices_total_ck  CHECK (total = subtotal + tax_amount - discount_amount + extra_charges_amount),
  CONSTRAINT invoices_amounts_ck CHECK (subtotal >= 0 AND tax_amount >= 0 AND discount_amount >= 0 AND extra_charges_amount >= 0)
);

-- A case MAY appear on more than one invoice, but the API must warn the admin first
-- (see "Duplicate-billing warning" below).
CREATE TABLE invoice_cases (
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES cases(id)    ON DELETE RESTRICT,
  added_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, case_id)
);
CREATE INDEX idx_invoice_cases_case ON invoice_cases (case_id);     -- "which invoices already contain this case?" + FK
```

**Duplicate-billing warning (service rule, not a constraint).** When an admin adds cases to an invoice (create or edit), run this once for the selected ids and return the hits as `warnings`, so the UI can ask "already billed — add anyway?" and resend with `confirmDuplicateBilling: true`:

```sql
SELECT ic.case_id, c.case_number, i.id AS invoice_id, i.invoice_number, i.status
  FROM invoice_cases ic
  JOIN invoices i ON i.id = ic.invoice_id
  JOIN cases    c ON c.id = ic.case_id
 WHERE ic.case_id = ANY($1::uuid[])
   AND ic.invoice_id <> $2;          -- $2 = invoice being edited (nil uuid when creating)
```

Served by `idx_invoice_cases_case`. Write an `activity_logs` row (`invoice.duplicate_billing_confirmed`) when the admin overrides.

### G. Engagement

```sql
CREATE TABLE offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             varchar(200) NOT NULL,
  brand             varchar(120) NOT NULL,
  category          varchar(50)  NOT NULL,
  description       text NOT NULL,
  discount          varchar(120) NOT NULL,
  start_date        date,
  valid_till        date NOT NULL,
  target_client_ids uuid[] NOT NULL DEFAULT '{}',     -- empty = everyone
  target_locations  text[] NOT NULL DEFAULT '{}',
  sponsored         boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_dates_ck CHECK (start_date IS NULL OR valid_till >= start_date)
);

CREATE TABLE offer_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id)   ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      varchar(50) NOT NULL DEFAULT 'claimed',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_claims_uq UNIQUE (offer_id, client_id)
);

CREATE TABLE tutorials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             varchar(200) NOT NULL,
  category          varchar(40)  NOT NULL DEFAULT 'Getting Started',
  description       text NOT NULL,
  youtube_video_id  varchar(32)  NOT NULL,
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

### H. Helpers (triggers)

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated  BEFORE UPDATE ON profiles              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_catalog_updated   BEFORE UPDATE ON service_catalog       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cpl_updated       BEFORE UPDATE ON client_price_list     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cases_updated     BEFORE UPDATE ON cases                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_details_updated   BEFORE UPDATE ON case_details          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated   BEFORE UPDATE ON support_tickets       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_forms_updated     BEFORE UPDATE ON preference_forms      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated  BEFORE UPDATE ON invoices              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_offers_updated    BEFORE UPDATE ON offers                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutorials_updated BEFORE UPDATE ON tutorials             FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep the promoted columns, search_text and row_version consistent no matter which service writes the row.
CREATE FUNCTION cases_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.case_type := COALESCE(NEW.sub_type_data->>'caseType', NEW.sub_type_data->>'caseType1', NEW.case_type);
  IF jsonb_typeof(NEW.sub_type_data->'teeth') = 'array' THEN
    NEW.teeth := ARRAY(SELECT jsonb_array_elements_text(NEW.sub_type_data->'teeth')::smallint);
  END IF;
  NEW.search_text := lower(concat_ws(' ',
      NEW.case_number, NEW.category, NEW.case_type,
      (SELECT string_agg(e.value, ' ') FROM jsonb_each_text(NEW.sub_type_data) e
        WHERE jsonb_typeof(NEW.sub_type_data -> e.key) = 'string')));
  IF TG_OP = 'UPDATE' THEN NEW.row_version := OLD.row_version + 1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cases_write BEFORE INSERT OR UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION cases_before_write();
```

---

## 5. Indexes — every one tied to a real query

All created `CONCURRENTLY` in production migrations; written here as plain `CREATE INDEX` for the scratch check.

```sql
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

-- files ------------------------------------------------------------------------------------------
CREATE INDEX idx_files_case_kind           ON files (case_id, kind, created_at) WHERE deleted_at IS NULL AND case_id IS NOT NULL;   -- per-case file panels; first scan = DISTINCT ON
CREATE INDEX idx_files_message             ON files (message_id) WHERE message_id IS NOT NULL;             -- chat attachments
CREATE INDEX idx_files_scan_name           ON files (client_id, lower(file_name)) WHERE kind = 'scan' AND deleted_at IS NULL;       -- duplicate-file check
CREATE INDEX idx_files_name_trgm           ON files USING gin (lower(file_name) gin_trgm_ops) WHERE kind = 'scan';                  -- search by file name
CREATE INDEX idx_files_purge               ON files (purge_after) WHERE purged_at IS NULL AND status = 'ready';                     -- retention job
CREATE INDEX idx_files_orphans             ON files (created_at) WHERE case_id IS NULL AND message_id IS NULL;                      -- sweep abandoned/pending uploads
CREATE INDEX idx_files_client_size         ON files (client_id) INCLUDE (size_bytes) WHERE status = 'ready';                        -- per-lab storage usage (index-only)

-- bulk downloads -----------------------------------------------------------------------------------
CREATE INDEX idx_bulk_latest               ON case_bulk_downloads (case_id, scope, completed_at DESC) WHERE status = 'completed';
CREATE INDEX idx_bulk_client_scope         ON case_bulk_downloads (client_id, scope, completed_at DESC) WHERE status = 'completed';
CREATE UNIQUE INDEX uq_bulk_in_flight      ON case_bulk_downloads (case_id, scope) WHERE status = 'in_progress';                    -- at most one running per case+scope
CREATE INDEX idx_bulk_downloader           ON case_bulk_downloads (downloaded_by) WHERE downloaded_by IS NOT NULL;

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
```

**Indexes deliberately NOT carried over:** `cases_created_at_idx`, `cases_client_id_created_at_idx`, `cases_updated_at_idx` (prefixes of the new composites), `profiles.email_idx` (duplicate of the unique), `chat_messages_case_id_idx`, `chat_read_states_case_user_idx` (now the PK), `notifications_read/type/created_at/user_dismissed` (replaced by two partial indexes), `offers_sponsored_idx` (2-value column), `tutorials_youtube_video_id_idx`, `case_files_case_id_idx`.

---

## 6. Rollups for dashboards & analytics

The admin/client analytics endpoints (`kpis`, `tat-trend`, `type-mix`, `delivery-status`, `on-hold-reasons`) aggregate raw `cases` on every call. Two small materialized views make them O(days) instead of O(cases):

```sql
CREATE MATERIALIZED VIEW mv_cases_created_daily AS
SELECT date_trunc('day', created_at)::date AS day,
       client_id, category, status,
       count(*) AS cases
  FROM cases
 GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX ON mv_cases_created_daily (day, client_id, category, status);
CREATE INDEX        ON mv_cases_created_daily (client_id, day);

CREATE MATERIALIZED VIEW mv_cases_completed_daily AS
SELECT date_trunc('day', completed_at)::date AS day,
       client_id, category,
       count(*)                      AS cases,
       sum(tat_minutes)              AS tat_minutes_sum,
       count(tat_minutes)            AS tat_samples
  FROM cases
 WHERE completed_at IS NOT NULL
 GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX ON mv_cases_completed_daily (day, client_id, category);
CREATE INDEX        ON mv_cases_completed_daily (client_id, day);
```

- Refresh every 5 min from a BullMQ repeatable job: `REFRESH MATERIALIZED VIEW CONCURRENTLY …` (needs the unique indexes above; readers are never blocked).
- `avg TAT days = sum(tat_minutes_sum) / sum(tat_samples) / 1440`; weekly/monthly buckets are `date_trunc` over the daily rows.
- Live "right now" numbers (admin dashboard cards, sidebar) stay on `cases` — one query replaces the seven counts:

```sql
SELECT status, count(*) FROM cases GROUP BY status;                  -- staff (uses idx_cases_status_created, small)
SELECT status, count(*) FROM cases WHERE client_id = $1 GROUP BY status;   -- lab (idx_cases_client_status)
```

- Monthly billing (`analytics/monthly-billing`, billing page) read **`invoices`** (`start_date` indexes) — not re-priced from cases. The "uninvoiced completed cases" list is
  `cases c LEFT JOIN invoice_cases ic ON ic.case_id = c.id WHERE c.status IN ('approved','delivered') AND ic.case_id IS NULL` (served by `idx_cases_billable`).

---

## 7. Redis design

| Key pattern                                            | Type                                                                       | TTL                                                                      | Purpose / invalidation                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `sess:{sha256(sid)}`                                   | string(JSON) `{userId, role, userType, clientId, status, csrf, createdAt}` | **7 h absolute** (matches today's `SESSION_MAX_AGE_SECONDS`), no sliding | session lookup; carrying role+clientId means **zero DB reads** for authz on most requests                                    |
| `user_sess:{userId}`                                   | set of session keys                                                        | 7 h                                                                      | revoke-all on password reset, suspend, role change                                                                           |
| `login_fail:{email}`                                   | counter                                                                    | 15 min                                                                   | lockout after 5 failures                                                                                                     |
| `login_ip:{ip}`, `rl:{route}:{ip}`                     | counter                                                                    | window                                                                   | sign-in 10/min, sign-up 5/5 min, forgot 5/5 min, admin-create 5/10 min (current limits)                                      |
| `pw_reset:{sha256(token)}`                             | string userId                                                              | 15 min                                                                   | single-use (`GETDEL`)                                                                                                        |
| `profile:{id}`                                         | JSON                                                                       | 1 h                                                                      | non-hot profile reads; delete on profile write                                                                               |
| `ver:client:{clientId}`, `ver:staff`                   | integer epoch                                                              | none                                                                     | **cache epoch**: bump with `INCR` on any case write instead of `SCAN`+`DEL`                                                  |
| `cases:list:{scope}:{epoch}:p{n}:l{limit}`             | JSON                                                                       | 5 min                                                                    | unfiltered case list pages; `{scope}` = `staff` or `c:{clientId}`; filtered views are not cached                             |
| `dash:staff:{epoch}`, `dash:client:{clientId}:{epoch}` | JSON                                                                       | 1 h                                                                      | dashboard cards (epoch makes it correct as well as fast)                                                                     |
| `price-list:{clientId}`                                | JSON                                                                       | 1 h                                                                      | invalidate on price-list/catalog edit                                                                                        |
| `billing:*`, `invoices:*`                              | JSON                                                                       | 30 min                                                                   | invalidate on invoice create/update                                                                                          |
| `badges:{userId}`                                      | JSON                                                                       | 15 s                                                                     | sidebar badges; DEL on `PATCH /sidebar-badges`                                                                               |
| `bulk:active:{userId}`                                 | counter/set                                                                | 10 min                                                                   | concurrent bulk-download slot limit (existing)                                                                               |
| BullMQ queues                                          | —                                                                          | —                                                                        | `auto-approve` (hourly), `r2-orphans` (daily), `r2-retention-mark` (daily), `mv-refresh` (5 min), `notify-email`, `bulk-zip` |

Redis must run with `maxmemory-policy noeviction` for BullMQ/sessions, or sessions + queues on one instance and caches on a second `allkeys-lru` instance (recommended once cache volume grows). Persistence: AOF `everysec` so a restart does not log everyone out.

---

## 8. Cloudflare R2 layout

- **Bucket is private.** Downloads: authorize in Fastify (role + `files.client_id`), then return a short-lived (60–300 s) **presigned GET** — the Node process never streams file bytes except for bulk ZIP.
- **Key:** `labs/{client_id}/cases/{case_id or _pending}/{kind}/{file_id}/{sanitized_file_name}` — immutable, collision-free, safe if a lab is renamed. `files.r2_key` is the only place keys are stored; the old `/api/cases/files?labName=…` URL format is retired.
- **Upload (multipart, up to the existing 5 GB cap):** `POST /files/uploads` creates a `files` row (`status='pending'`, `upload_id`) → presigned `UploadPart` URLs → `POST …/complete` flips `status='ready'`, sets `size_bytes`, `ready_at`, `purge_after`. Case creation then sets `files.case_id` (attach), instead of trusting client-supplied URLs.
- **Cleanup without bucket listing:** current retention/cleanup scripts `ListObjectsV2` the _entire bucket_. With the registry:
  - orphans: `idx_files_orphans` → abort multipart (`upload_id`) / delete key / delete row (daily);
  - retention (3 months, all kinds, no exemptions; `purge_after = created_at + interval '3 months'`): `idx_files_purge` → delete keys in 1000-key batches, set `status='purged', purged_at=now()`; the UI shows "expired" instead of a broken link;
  - keep an R2 lifecycle rule for `AbortIncompleteMultipartUpload` (1 day) as a safety net.
- **Per-lab storage usage:** `SELECT client_id, sum(size_bytes) FROM files WHERE status='ready' GROUP BY 1` (index-only via `idx_files_client_size`).

---

## 9. Role → data-access rules the services must enforce

Derived from `api/cases/route.ts`, `api/cases/[id]/route.ts`, `lib/case-access.ts`, `lib/chat.ts`, `api/cases/files`, `api/offers`, `api/billing`, `api/sidebar-badges`. Other route groups follow the `admin/*` vs `client/*` directory convention — **verify those against the code when porting** (I read their headers, not every line).

| Capability                                                                       | client                                                                                               | subuser                                         | admin                                     | qc                                                | designer                           | account_manager |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------- |
| List cases                                                                       | own lab                                                                                              | parent lab                                      | all                                       | all                                               | all (`assignedTo=me` filter)       | all             |
| Create case                                                                      | yes (`client_id` = self)                                                                             | yes (`client_id` = parent, `subuser_id` = self) | yes, must pass `clientId`                 | yes (any admin-portal role passes the type check) | yes                                | yes             |
| Edit core fields (category, sub-type, due date, case no.)                        | only while status ∈ {`scan_received`, `allocated_to_designer`, `scan_verified`, `scan_not_verified`} | same                                            | any time                                  | ✗ 403                                             | ✗ 403                              | ✗ read-only     |
| Assign designer / QC / AM                                                        | ✗                                                                                                    | ✗                                               | all three                                 | designer + qc                                     | qc; may self-claim unassigned case | ✗               |
| Change status                                                                    | see transition table below                                                                           | same as client                                  | any (needs output file for `internal_qc`) | see table                                         | see table                          | ✗               |
| Cancel                                                                           | before design starts (`canClientCancelCase`)                                                         | same                                            | until approved/delivered                  | ✗                                                 | ✗                                  | ✗               |
| Case chat                                                                        | own lab's cases                                                                                      | own lab's cases                                 | all                                       | assigned only                                     | assigned only                      | assigned only   |
| Download files                                                                   | own lab prefix                                                                                       | parent lab prefix                               | all                                       | all                                               | all                                | all (GET only)  |
| Upload/delete files                                                              | own lab                                                                                              | own lab                                         | all                                       | all                                               | all                                | ✗               |
| See staff-only fields (`internal_files_downloaded_at`, internal timeline events) | ✗ stripped                                                                                           | ✗ stripped                                      | ✓                                         | ✓                                                 | ✓                                  | ✓               |
| Invoices / billing                                                               | own invoices (`/client/invoices`)                                                                    | same                                            | all (billing, invoices, client-payments)  | —                                                 | —                                  | —               |
| Offers                                                                           | read active                                                                                          | read active                                     | read all, create/update/delete            | read                                              | read                               | read            |
| Support tickets                                                                  | own lab                                                                                              | own lab                                         | all (`/admin/support`)                    | ✓ admin routes (fan-out)                          | —                                  | ✓ (fan-out)     |
| Clients/members/price list/approve/plan                                          | ✗                                                                                                    | ✗                                               | ✓                                         | ✗                                                 | ✗                                  | ✗               |

**Scoping rule for the service layer:** lab roles → always `WHERE client_id = session.clientId` (never accept `clientId` from the request); staff list routes accept optional `clientId` filter; strip `internal_files_downloaded_at`, `internal_files_downloaded_by`, `client_output_downloaded_by` and `client_visible = false` timeline rows for lab roles.

### Status transitions (seed for `case_status_transitions`)

| Role             | From → To                                                                                                                 | Extra conditions                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| client / subuser | `scan_received`·`scan_not_verified`·`scan_verified` → `on_hold`                                                           | before design starts                                    |
| client / subuser | `on_hold` → `scan_received`                                                                                               | resume                                                  |
| client / subuser | `submitted_to_client` → `approved` · `change_requested` · `client_reject`                                                 | only from Client Review                                 |
| client / subuser | any non-finished → `cancelled`                                                                                            | only via `canClientCancelCase`                          |
| admin            | any → any allowed status                                                                                                  | `internal_qc` needs an output file                      |
| designer         | `scan_received` → `scan_verified`                                                                                         | case has no designer yet                                |
| designer         | `allocated_to_designer`·`scan_verified`·`client_feedback` → `in_progress`                                                 | `designer_id = me`                                      |
| designer         | `in_progress` → `internal_qc`                                                                                             | needs `qc_id` and output file                           |
| designer         | `internal_qc` → `in_progress`; `submitted_to_client` → `internal_qc`                                                      | undo                                                    |
| designer         | non-finished → `on_hold`; `on_hold` → `scan_received`                                                                     | `designer_id = me` for resume                           |
| qc               | `scan_*`/`client_feedback`/`client_reject` → `in_progress`                                                                | `designer_id` set                                       |
| qc               | `in_progress` → `internal_qc`                                                                                             | qc or designer of the case; needs QC lead + output file |
| qc               | `internal_qc` → `submitted_to_client` · `client_feedback`; `change_requested` → `client_feedback` · `submitted_to_client` | `qc_id = me`                                            |
| qc               | `submitted_to_client` → `internal_qc`                                                                                     | `qc_id = me` (undo)                                     |
| qc               | non-finished → `on_hold`; `on_hold` → `scan_received`                                                                     | `qc_id` or `designer_id = me`                           |
| account_manager  | —                                                                                                                         | read-only                                               |

Side effects the service must keep (currently inline in the route): first `in_progress` sets `started_at`; `approved` sets `completed_at` and `tat_minutes`; `submitted_to_client` sets `submitted_to_client_at`; undo from `submitted_to_client` clears it; every change writes an `activity_logs` row with `client_visible`/`client_label`, and bumps the Redis epoch (§7).

---

## 10. Old → new mapping (for the data migration)

| Old                                                                           | New                                                  | Migration note                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.users` (Supabase)                                                       | `users`                                              | copy `encrypted_password` (bcrypt `$2a$…`) into `password_hash`; on first successful sign-in verify with bcrypt then re-hash to argon2id and overwrite (`password_changed_at` unchanged). `scripts/migrate-supabase.sh` in the old repo already copies auth users with hashes. |
| `profiles`                                                                    | `profiles`                                           | `email` → `users.email`; `plan_status` lowercased; `client_id` computed (`client`→`id`, `subuser`→`created_by`); drop `password`, `enabled_service_types`, legacy milling columns                                                                                              |
| `sub_users`                                                                   | _(deleted)_                                          | information is `profiles.client_id`                                                                                                                                                                                                                                            |
| `cases`                                                                       | `cases` + `case_details`                             | `created_by` text → look up by name or leave `NULL`; `start_time`→`started_at`, `delivered_time`→`completed_at`, `tat`→`tat_minutes`; `case_type`/`teeth` derived from `sub_type_data` by the trigger on first touch (`UPDATE cases SET sub_type_data = sub_type_data`)        |
| `cases.timeline` + `activity_logs`                                            | `activity_logs`                                      | explode timeline JSON into rows with `client_visible = NOT clientHidden`, `client_label = clientLabel`                                                                                                                                                                         |
| `case_files`, `case_preview_files`, `case_reference_files`, `case_hold_files` | `files` (`kind` = scan / preview / reference / hold) | `r2_key` = old key (`labName/fileName`) **initially**; new uploads use the new scheme; a background job can copy-and-rename old objects. `cases.output_file` / `preview_file` / `teeth_library_file_url` → `files` rows (`output` / `preview` / `teeth_library`)               |
| `chat_messages` (+ file columns)                                              | `chat_messages` + `files(kind='chat')`               |                                                                                                                                                                                                                                                                                |
| `chat_read_states`                                                            | same, PK `(case_id,user_id)`                         |                                                                                                                                                                                                                                                                                |
| `notification_preferences` (36 booleans)                                      | `notification_settings` + rows                       | only write rows where a switch is `false` (defaults are on)                                                                                                                                                                                                                    |
| `invoices.case_ids`                                                           | `invoice_cases`                                      | unnest the JSON array; cases already on several old invoices load as-is (duplicates are allowed)                                                                                                                                                                               |
| `offers`                                                                      | `offers`                                             | `varchar` dates → `date`; JSON arrays → `uuid[]`/`text[]`                                                                                                                                                                                                                      |
| `pricing_crown_bridge`, `pricing_implants`, `get_case_price`                  | _(dropped)_                                          | after porting `/api/service-pricing`                                                                                                                                                                                                                                           |

```sql
-- Optional audit after load: cases that sit on more than one invoice
SELECT case_id, array_agg(invoice_id) AS invoices
  FROM invoice_cases GROUP BY case_id HAVING count(*) > 1;
```

---

## 11. Decisions that change behaviour (confirmed)

1. **Session lifetime — decided: 7 h absolute**, no sliding renewal (`src/auth/session.js` updated to match).
2. **Designer workload** (decided) now excludes `cancelled` and `client_reject` (today only `approved`/`delivered` are excluded, so cancelled cases inflate load).
3. **Re-billing is allowed but warned (decided):** no `UNIQUE(case_id)`; the invoice API returns a warning listing earlier invoices that already contain a selected case and needs explicit confirmation.
4. **Lab-name uniqueness** is now a UX rule (partial unique index on `lower(lab_name)` for clients) — it is no longer needed for storage-key safety.
5. **File URLs** become opaque file ids (`GET /files/:id/download` → presigned URL); the Next.js frontend must stop building `/api/cases/files?labName=…` links.
6. **Retention (decided):** every R2 object older than 3 months is deleted — all kinds including `output`, no exemptions. `purge_after = created_at + 3 months`; the delete is visible to the UI (`status='purged'`).
7. **`consultant` role removed** (decided) from the enum, checks, matrix and notification fan-out; `account_manager` kept as read-only.
8. **Tooth numbers are not constrained** (FDI vs Universal numbering depends on what the 3Shape import emits); add a `CHECK` on `teeth` once that is confirmed.

---

## 12. Verification performed

The DDL in §3–§6 was loaded into a throw-away database on a local PostgreSQL 16 container (then dropped; nothing else was touched). Results:

- **Loads cleanly** with `ON_ERROR_STOP` — all enums, tables, 69 indexes, triggers, functions and both materialized views.
- **Constraints reject bad data:** duplicate email differing only by case; `lab_portal` + `admin` role; sub-user pointing at itself; `completed_at` on a non-final status; `invoices.total` that is not `subtotal + tax − discount + extra`; the same case on two invoices; a second in-flight bulk download for the same case/scope.
- **Triggers work:** `case_type`, `teeth`, `teeth_count`, `search_text` filled from `sub_type_data`; `updated_at` and `row_version` bump on update; `next_invoice_number()` returned `Inv_2026_0001`, `Inv_2026_0002`; ticket numbers `TKT-2026-000001`; `REFRESH MATERIALIZED VIEW CONCURRENTLY` succeeds on both views.
- **Query plans on 100 000 cases / 200 labs:** lab list `ORDER BY created_at DESC, id DESC LIMIT 100` → index-only scan on `idx_cases_client_created` (0.6 ms); staff status tab → ordered index scan (0.9 ms); search for a rare term → bitmap scan on `idx_cases_search_trgm` (27 ms; the old `sub_type_data::text ILIKE` can only seq-scan); auto-approve probe → `idx_cases_review_clock`; billable-per-client → `idx_cases_billable`.

Not measured: production-sized data, concurrent write load, the Redis/R2 parts (they are design only), and the data-migration scripts in §10.

---

## 13. Implementation notes (what the built system does differently from this design)

The migrations in `db/migrations/` are the executable truth; where they differ from §4–§6 this list says why.

- **Search**: `cases.search_text` holds case number, category, type and sub-type values only. File-name and lab-name
  search go through the trigram indexes on `files` / `profiles` (the design appended file names to `search_text`; a
  second trigger and stale-text risk were not worth it).
- **Case numbers** come from `cases_number_seq` (migration `…0700`), not the design's per-year counter.
- **Transitions** are seeded in `case_status_transitions`; assignment and "needs output file / QC lead" flags are
  enforced by `services/cases.js`.
- **Invoices**: `invoice_cases` has `added_by` / `added_at`, and no `UNIQUE(case_id)` (re-billing is allowed but must be
  confirmed — decision 3).
- **Designer workload** excludes cancelled and rejected cases (decision 2).
- **Sessions** are 7 hours absolute (decision 1); there is no `consultant` role (decision 5); R2 retention is 3 months for
  every kind (decision 4).
- **Chat attachments** are `files` rows of kind `chat` with `case_id` set until a message claims them, then
  `message_id` is set and `case_id` cleared (the table's CHECK allows only one of the two).
- **Analytics buckets** are days up to 31 days and months beyond; hourly buckets were dropped because the rollup views
  are daily.
