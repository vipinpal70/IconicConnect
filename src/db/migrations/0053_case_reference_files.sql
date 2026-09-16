-- Reference images uploaded by the client/lab at case-creation time (up to
-- 5, optional — case-modification-plan.md §2). Kept as its own table, not
-- reusing case_files, so reference images never leak into the "Case Files"
-- (input scan) list or the file-name duplicate-detection check in
-- POST /api/cases — same reasoning as 0051_case_preview_files.sql.
CREATE TABLE IF NOT EXISTS "case_reference_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(100),
	"file_size" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
-- IF NOT EXISTS has no equivalent for ADD CONSTRAINT, and this table (with
-- both FKs already in place) was created manually on some environments
-- while this migration was blocked earlier in development — guard each
-- with the same DO $$ ... EXCEPTION pattern 0046_drop_service_catalog_
-- service_type.sql uses, so a re-run doesn't fail on an already-applied DB.
DO $$ BEGIN
  ALTER TABLE "case_reference_files" ADD CONSTRAINT "case_reference_files_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_reference_files" ADD CONSTRAINT "case_reference_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_reference_files_case_id_idx" ON "case_reference_files" ("case_id");
