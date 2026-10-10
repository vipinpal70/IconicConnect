-- Offers, offer claims, tutorials.

-- migrate:up
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

-- migrate:down
DROP TABLE IF EXISTS tutorials;
DROP TABLE IF EXISTS offer_claims;
DROP TABLE IF EXISTS offers;
