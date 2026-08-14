-- Milling center admin-level onboarding & per-flow service catalog
-- (see milling-center-admin-level-plan.md).

-- 1. milling_centers — step-1 (company/contacts/contract) + step-2
-- (coverage/services) fields.
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "owner_name" varchar(100);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "owner_email" varchar(255);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "owner_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "finance_poc_name" varchar(100);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "finance_poc_email" varchar(255);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "finance_poc_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "contract_doc_key" text;--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "contract_doc_name" varchar(255);--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "contract_doc_uploaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "states_served" text[];--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "avg_tat_days" integer;--> statement-breakpoint
ALTER TABLE "milling_centers" ADD COLUMN IF NOT EXISTS "enabled_service_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint

-- 2. milling_service_catalog — never had any API/UI wired to it, so it has
-- zero rows in every environment; safe to add NOT NULL "service_type"
-- without a backfill default.
ALTER TABLE "milling_service_catalog" ADD COLUMN IF NOT EXISTS "service_type" "service_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "milling_service_catalog" ADD COLUMN IF NOT EXISTS "monthly_capacity" integer;--> statement-breakpoint
ALTER TABLE "milling_service_catalog" ADD CONSTRAINT "milling_service_catalog_center_type_category_uniq" UNIQUE("milling_center_id","service_type","category","sub_category");