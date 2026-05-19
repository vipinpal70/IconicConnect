ALTER TABLE "cases" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" SET DEFAULT 'scan_received'::text;--> statement-breakpoint
DROP TYPE "public"."case_status";--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('scan_received', 'allocated_to_designer', 'scan_verified', 'scan_not_verified', 'in_progress', 'internal_qc', 'submitted_to_client', 'on_hold', 'client_feedback', 'approved', 'delivered');--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" SET DEFAULT 'scan_received'::"public"."case_status";--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" SET DATA TYPE "public"."case_status" USING "status"::"public"."case_status";