-- 3D Dental CAD / DICOM Platform: Annotation Documents & Version History
-- Explicit save architecture: durable storage for 3D markups, layers, measurements, and review comments.

-- migrate:up
CREATE TABLE annotation_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  revision        integer NOT NULL DEFAULT 1,
  schema_version  integer NOT NULL DEFAULT 1,
  document_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annotation_documents_case_id_key UNIQUE (case_id)
);

CREATE INDEX annotation_documents_case_id_idx ON annotation_documents (case_id);

CREATE TABLE annotation_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES annotation_documents(id) ON DELETE CASCADE,
  case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  revision        integer NOT NULL,
  document_data   jsonb NOT NULL,
  saved_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  saved_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX annotation_versions_doc_rev_idx ON annotation_versions (document_id, revision DESC);
CREATE INDEX annotation_versions_case_id_idx ON annotation_versions (case_id);

-- migrate:down
DROP TABLE IF EXISTS annotation_versions;
DROP TABLE IF EXISTS annotation_documents;
