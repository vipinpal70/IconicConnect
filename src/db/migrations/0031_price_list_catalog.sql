-- Drop unused Supabase-only pricing tables (never managed by Drizzle ORM)
DROP TABLE IF EXISTS "pricing_cosmetics";--> statement-breakpoint
DROP TABLE IF EXISTS "pricing_dentures";--> statement-breakpoint
DROP TABLE IF EXISTS "pricing_appliances";--> statement-breakpoint
DROP TABLE IF EXISTS "pricing_implants";--> statement-breakpoint
DROP TABLE IF EXISTS "pricing_crown_bridge";--> statement-breakpoint
DROP FUNCTION IF EXISTS "get_case_price";--> statement-breakpoint
DROP FUNCTION IF EXISTS "get_implant_price";--> statement-breakpoint

-- Drop old free-form price list table
DROP TABLE IF EXISTS "client_price_list_items";--> statement-breakpoint

-- unit_type enum
DO $$ BEGIN
  CREATE TYPE "public"."unit_type" AS ENUM('per_tooth', 'per_arch');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Central service catalog (template for all clients)
CREATE TABLE "service_catalog" (
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

-- Per-client price list (allocated from catalog, prices editable per client)
CREATE TABLE "client_price_list" (
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

ALTER TABLE "client_price_list" ADD CONSTRAINT "client_price_list_client_id_profiles_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "client_price_list" ADD CONSTRAINT "client_price_list_catalog_item_id_service_catalog_id_fk"
  FOREIGN KEY ("catalog_item_id") REFERENCES "public"."service_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "client_price_list" ADD CONSTRAINT "client_price_list_created_by_profiles_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "service_catalog_category_idx" ON "service_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "client_price_list_client_id_idx" ON "client_price_list" USING btree ("client_id");--> statement-breakpoint

-- Seed 22 catalog items from billing_price_calculation.md
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
  ('Cosmetics',      'Snap on Smile',    'per_arch',  15.00, 22);
