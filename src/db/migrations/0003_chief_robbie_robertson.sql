ALTER TABLE "cases" ALTER COLUMN "status" SET DEFAULT 'scan_received';--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "category" varchar(100);--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "sub_type_data" jsonb;