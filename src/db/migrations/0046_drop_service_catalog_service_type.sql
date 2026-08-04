-- A previously reverted "Design+Milling" pricing feature left a `service_type`
-- column on service_catalog (design_only / design_milling), doubling every
-- catalog item and, by extension, every client's allocated price list. The
-- feature was removed from the app code but this column/constraint was never
-- rolled back. This migration removes the milling duplicate rows and restores
-- the plain (category, sub_category) uniqueness the current schema expects.

DELETE FROM "service_catalog" WHERE "service_type" = 'design_milling';--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "service_catalog" DROP CONSTRAINT "service_catalog_category_sub_category_service_type_uniq";
EXCEPTION WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "service_catalog" DROP COLUMN IF EXISTS "service_type";--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_category_sub_category_uniq" UNIQUE ("category", "sub_category");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
