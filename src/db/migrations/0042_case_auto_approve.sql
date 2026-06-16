ALTER TABLE "cases" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "submitted_to_client_at" timestamp;
