-- Multiple preview files per case. Kept as its own table (mirrors case_files)
-- rather than reusing case_files, so previews never leak into the client-facing
-- "Case Files" (input scans) list — see bulk/confirm/route.ts for the same reasoning
-- applied to the single-preview-file predecessor of this feature.
CREATE TABLE IF NOT EXISTS "case_preview_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(100),
	"file_size" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "case_preview_files" ADD CONSTRAINT "case_preview_files_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_preview_files" ADD CONSTRAINT "case_preview_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_preview_files_case_id_idx" ON "case_preview_files" ("case_id");
