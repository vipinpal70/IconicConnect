-- Service catalog: Milling Only becomes a third real case flow, alongside
-- design_only and design_milling (see service-catlog-manage-plan.md).

-- 1. New service_type value
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'milling_only';--> statement-breakpoint

-- 2. client_price_list — client-level enable/disable override, independent
-- of serviceCatalog.isActive (system-level). Both must be true for a client
-- to see/order a service.
ALTER TABLE "client_price_list" ADD COLUMN IF NOT EXISTS "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- 3. profiles — which flows a client can submit cases for / see pricing on.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "enabled_service_types" text[] DEFAULT '{design_only}' NOT NULL;--> statement-breakpoint

-- 4. Backfill: existing clients already use both current flows today, so
-- migration must not take anything away from them. Only future new clients
-- default to design_only only.
UPDATE "profiles"
SET "enabled_service_types" = ARRAY['design_only', 'design_milling']
WHERE "user_type" = 'lab_portal' AND "user_role" = 'client';--> statement-breakpoint

-- 5. Seed milling_only catalog rows is done by
-- scripts/seed-milling-only-catalog.mjs, run once after this migration —
-- NOT inline here. Postgres forbids using a value added by ALTER TYPE ...
-- ADD VALUE within the same transaction that added it, and this project's
-- migration runner (scripts/migrate.mjs) batches every pending migration
-- into one transaction, so an INSERT using 'milling_only' in this same file
-- would fail on any environment migrating from scratch.