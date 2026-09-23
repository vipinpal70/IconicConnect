-- Images explaining why a case was put on hold (hold_images-plan.md). Mirrors
-- 0051_case_preview_files.sql / 0053_case_reference_files.sql: kept out of
-- case_files so these never leak into the client-facing "Case Files" list or
-- its duplicate-detection check. Flat per-case (no hold-event id) on purpose —
-- see hold_images-plan.md §4.4 for the trade-off.
CREATE TABLE IF NOT EXISTS "case_hold_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(100),
	"file_size" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_hold_files" ADD CONSTRAINT "case_hold_files_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_hold_files" ADD CONSTRAINT "case_hold_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_hold_files_case_id_idx" ON "case_hold_files" ("case_id");
