-- Add per_case unit type for Model billing
ALTER TYPE "public"."unit_type" ADD VALUE IF NOT EXISTS 'per_case';--> statement-breakpoint

-- Add Model - 3D Model to the central service catalog
INSERT INTO "service_catalog" ("category", "sub_category", "unit_type", "default_price", "sort_order")
VALUES ('Model', '3D Model', 'per_case', 4.00, 23)
ON CONFLICT ("category", "sub_category") DO NOTHING;--> statement-breakpoint

-- Seed the Model entry into every existing client's price list
INSERT INTO "client_price_list" ("client_id", "catalog_item_id", "price")
SELECT p."id", sc."id", sc."default_price"
FROM "profiles" p
CROSS JOIN "service_catalog" sc
WHERE p."user_role" = 'client'
  AND sc."category" = 'Model'
  AND sc."sub_category" = '3D Model'
ON CONFLICT ("client_id", "catalog_item_id") DO NOTHING;
