-- Bulk-download tracking (bulk-download-check-plan.md).
-- Event table = source of truth; two nullable timestamps on cases = cache for list badges/filters.

DO $$ BEGIN
  CREATE TYPE "public"."bulk_download_scope" AS ENUM ('client_output', 'internal_files');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."bulk_download_status" AS ENUM ('in_progress', 'completed', 'failed', 'reset');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "case_bulk_downloads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "public"."cases"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "public"."profiles"("id"),
  "scope" "bulk_download_scope" NOT NULL,
  "status" "bulk_download_status" DEFAULT 'in_progress' NOT NULL,
  "downloaded_by" uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
  "downloaded_by_role" varchar(50),
  "files_delivered" integer DEFAULT 0 NOT NULL,
  "bytes_delivered" bigint DEFAULT 0 NOT NULL,
  "content_signature" varchar(64),
  "fingerprints" jsonb,
  "include" jsonb,
  "failure_reason" text,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_bulk_downloads_case_scope_idx" ON "case_bulk_downloads" ("case_id", "scope", "completed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_bulk_downloads_client_scope_idx" ON "case_bulk_downloads" ("client_id", "scope", "completed_at");
--> statement-breakpoint
-- The concurrency claim: one in-flight download per case + scope.
CREATE UNIQUE INDEX IF NOT EXISTS "case_bulk_downloads_in_flight_uidx" ON "case_bulk_downloads" ("case_id", "scope") WHERE "status" = 'in_progress';
--> statement-breakpoint

ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "client_output_downloaded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "internal_files_downloaded_at" timestamp;
--> statement-breakpoint

-- Same lock-down as 0056: this table is only ever touched by the server (Drizzle), never via PostgREST.
ALTER TABLE "case_bulk_downloads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "case_bulk_downloads" FROM anon, authenticated;
