-- Phase 1: Milling fulfillment layer schema (see milling-implementation-plan.md)

-- 1A. profiles — milling portal user type/roles + centre link
ALTER TYPE "public"."user_type" ADD VALUE IF NOT EXISTS 'milling_portal';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'milling_admin';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'milling_production';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'milling_support';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "milling_center_id" uuid;--> statement-breakpoint

-- 1B. cases — milling statuses + service type
ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'ready_for_milling';--> statement-breakpoint
ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'milling_in_progress';--> statement-breakpoint
ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'milling_qc';--> statement-breakpoint
ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'packaging';--> statement-breakpoint
ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'dispatched';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."service_type" AS ENUM('design_only', 'design_milling');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "service_type" "service_type" DEFAULT 'design_only' NOT NULL;--> statement-breakpoint

-- 1C-bis. service_catalog — second "Design + Milling" price list, same
-- category/subCategory grouping as the existing "Design" list, different price.
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "service_type" "service_type" DEFAULT 'design_only' NOT NULL;--> statement-breakpoint

ALTER TABLE "service_catalog" DROP CONSTRAINT IF EXISTS "service_catalog_category_sub_category_uniq";--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_category_sub_category_service_type_uniq"
    UNIQUE("category", "sub_category", "service_type");
-- UNIQUE constraints create a backing index, so a re-run raises duplicate_table
-- (42P07) rather than duplicate_object (42710) — catch both to stay idempotent.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint

-- Backfill a design_milling row for every existing design_only catalog item.
-- Price starts equal to the Design price — admin adjusts it in Admin > Milling > Pricing.
INSERT INTO "service_catalog" ("category", "sub_category", "service_type", "unit_type", "default_price", "sort_order", "is_active")
SELECT "category", "sub_category", 'design_milling', "unit_type", "default_price", "sort_order", "is_active"
FROM "service_catalog"
WHERE "service_type" = 'design_only'
ON CONFLICT ("category", "sub_category", "service_type") DO NOTHING;--> statement-breakpoint

-- 1C. Milling fulfillment tables
DO $$ BEGIN
  CREATE TYPE "public"."milling_status" AS ENUM('ready_for_milling', 'milling_in_progress', 'milling_qc', 'packaging', 'dispatched', 'delivered');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "milling_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(150) NOT NULL,
  "contact_name" varchar(100),
  "email" varchar(255),
  "phone" varchar(20),
  "city" varchar(100),
  "state" varchar(100),
  "country" varchar(100),
  "active" boolean DEFAULT true NOT NULL,
  "onboarded_at" date,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_milling_center_id_milling_centers_id_fk"
    FOREIGN KEY ("milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "profiles_milling_center_id_idx" ON "profiles" USING btree ("milling_center_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "milling_service_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "milling_center_id" uuid NOT NULL,
  "category" varchar(100) NOT NULL,
  "sub_category" varchar(100) NOT NULL,
  "unit_type" "unit_type" NOT NULL,
  "partner_rate" numeric(10, 2) NOT NULL,
  "turnaround_days" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_service_catalog" ADD CONSTRAINT "milling_service_catalog_milling_center_id_milling_centers_id_fk"
    FOREIGN KEY ("milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "milling_service_catalog_center_id_idx" ON "milling_service_catalog" USING btree ("milling_center_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "milling_routing_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(150) NOT NULL,
  "priority" integer DEFAULT 10 NOT NULL,
  "scope" jsonb NOT NULL,
  "milling_center_id" uuid NOT NULL,
  "fallback_milling_center_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_routing_rules" ADD CONSTRAINT "milling_routing_rules_milling_center_id_milling_centers_id_fk"
    FOREIGN KEY ("milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_routing_rules" ADD CONSTRAINT "milling_routing_rules_fallback_center_id_fk"
    FOREIGN KEY ("fallback_milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "milling_routing_rules_priority_idx" ON "milling_routing_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milling_routing_rules_center_id_idx" ON "milling_routing_rules" USING btree ("milling_center_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "milling_case_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "milling_center_id" uuid NOT NULL,
  "milling_status" "milling_status" NOT NULL,
  "carrier" varchar(50),
  "tracking_number" varchar(100),
  "shipment_eta" date,
  "notes" text,
  "ship_to_name" varchar(150),
  "ship_to_address" text,
  "assigned_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "milling_case_assignments_case_id_unique" UNIQUE("case_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_case_assignments" ADD CONSTRAINT "milling_case_assignments_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_case_assignments" ADD CONSTRAINT "milling_case_assignments_center_id_fk"
    FOREIGN KEY ("milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "milling_case_assignments_center_id_idx" ON "milling_case_assignments" USING btree ("milling_center_id");
