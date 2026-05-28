ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "approval_checklist" jsonb NOT NULL DEFAULT '[]'::jsonb;
