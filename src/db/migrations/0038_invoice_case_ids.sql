ALTER TABLE "invoices" ADD COLUMN "case_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
