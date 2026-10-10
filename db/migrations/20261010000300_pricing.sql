-- service_catalog, client_price_list, case_status_meta.

-- migrate:up
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

-- migrate:down
DROP TABLE IF EXISTS case_status_meta;
DROP TABLE IF EXISTS client_price_list;
DROP TABLE IF EXISTS service_catalog;
