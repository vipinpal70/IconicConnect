-- Atomic invoice numbering, invoices, invoice_cases join table.

-- migrate:up
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

-- migrate:down
DROP TABLE IF EXISTS invoices;
DROP FUNCTION IF EXISTS next_invoice_number();
DROP TABLE IF EXISTS invoice_counters;
