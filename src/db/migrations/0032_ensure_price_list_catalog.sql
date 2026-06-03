-- Idempotent migration: ensures service_catalog and client_price_list exist.
-- Migration 0031 may have failed on some VPS environments when dropping
-- Supabase-owned pricing tables. This migration recreates everything safely.

-- unit_type enum (no-op if already created by 0031)
DO $$ BEGIN
  CREATE TYPE "public"."unit_type" AS ENUM('per_tooth', 'per_arch');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" varchar(100) NOT NULL,
  "sub_category" varchar(100) NOT NULL,
  "unit_type" "unit_type" NOT NULL,
  "default_price" numeric(10, 2) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "service_catalog_category_sub_category_uniq" UNIQUE("category","sub_category")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_price_list" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "catalog_item_id" uuid NOT NULL,
  "price" numeric(10, 2) NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "client_price_list_client_catalog_uniq" UNIQUE("client_id","catalog_item_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_price_list"
    ADD CONSTRAINT "client_price_list_client_id_profiles_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_price_list"
    ADD CONSTRAINT "client_price_list_catalog_item_id_service_catalog_id_fk"
    FOREIGN KEY ("catalog_item_id") REFERENCES "public"."service_catalog"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_price_list"
    ADD CONSTRAINT "client_price_list_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "service_catalog_category_idx" ON "service_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_price_list_client_id_idx" ON "client_price_list" USING btree ("client_id");--> statement-breakpoint

-- Seed 22 catalog items — skips rows that already exist (from 0031)
INSERT INTO "service_catalog" ("category", "sub_category", "unit_type", "default_price", "sort_order") VALUES
  ('Crown & Bridge', 'Crown',            'per_tooth',  4.00,  1),
  ('Crown & Bridge', 'Bridge',           'per_tooth',  5.00,  2),
  ('Crown & Bridge', 'Cutback',          'per_tooth',  5.00,  3),
  ('Crown & Bridge', 'Coping',           'per_tooth',  5.00,  4),
  ('Crown & Bridge', 'Screw Retained',   'per_tooth', 10.00,  5),
  ('Crown & Bridge', 'In-Lay',           'per_tooth', 15.00,  6),
  ('Crown & Bridge', 'On-Lay',           'per_tooth', 20.00,  7),
  ('Implants',       'Robotic',          'per_tooth',  4.00,  8),
  ('Implants',       'Ti-Base',          'per_tooth',  4.00,  9),
  ('Implants',       'Custom',           'per_tooth',  4.00, 10),
  ('Appliances',     'Night Guards',     'per_arch',  15.00, 11),
  ('Appliances',     'Spot Guards',      'per_arch',  20.00, 12),
  ('Appliances',     'Mouth Guards',     'per_arch',  15.00, 13),
  ('Appliances',     'NTI',              'per_arch',  15.00, 14),
  ('Dentures',       'Reference Denture','per_arch',  15.00, 15),
  ('Dentures',       'Copy Denture',     'per_arch',  15.00, 16),
  ('Dentures',       'Immediate Denture','per_arch',  15.00, 17),
  ('Dentures',       'Full Denture',     'per_arch',  15.00, 18),
  ('Dentures',       'Partial Denture',  'per_arch',  15.00, 19),
  ('Cosmetics',      'Digital Wax Up',   'per_arch',  15.00, 20),
  ('Cosmetics',      'Veneers',          'per_arch',  15.00, 21),
  ('Cosmetics',      'Snap on Smile',    'per_arch',  15.00, 22)
ON CONFLICT ("category", "sub_category") DO NOTHING;
