-- Phase 7 of design-only-removal-plan.md — DESTRUCTIVE. Removes everything milling:
--   * milling tables + their enums
--   * profiles.milling_center_id / enabled_service_types / model_only_lab
--   * cases.service_type / design_source, service_catalog.service_type
--   * milling values from the case_status, user_type and user_role enums
--
-- The guard below aborts the whole migration (nothing is changed) if any case, profile,
-- activity log or milling centre still depends on what is removed. (Non-Design price-list
-- rows are deleted by step 0 instead — they are derived duplicates, not business data.)
-- Take a database backup before running this.

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "cases" WHERE "service_type" <> 'design_only';
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % case(s) still have service_type <> design_only (convert them first — see plan.md)', n; END IF;

  SELECT count(*) INTO n FROM "cases" WHERE "design_source" <> 'internal';
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % case(s) still have design_source <> internal', n; END IF;

  SELECT count(*) INTO n FROM "cases"
    WHERE "status"::text IN ('ready_for_milling', 'milling_in_progress', 'milling_qc', 'packaging', 'dispatched');
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % case(s) are still in a milling status', n; END IF;

  SELECT count(*) INTO n FROM "profiles"
    WHERE "user_type"::text = 'milling_portal'
       OR "user_role"::text IN ('milling_admin', 'milling_production', 'milling_support');
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % milling portal profile(s) still exist', n; END IF;

  SELECT count(*) INTO n FROM "activity_logs"
    WHERE "user_type"::text = 'milling_portal'
       OR "user_role"::text IN ('milling_admin', 'milling_production', 'milling_support');
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % activity_logs row(s) were written by milling users', n; END IF;

  SELECT count(*) INTO n FROM "milling_centers";
  IF n > 0 THEN RAISE EXCEPTION '0058 aborted: % milling centre(s) still exist', n; END IF;
END $$;
--> statement-breakpoint

-- 0. Non-Design price-list rows. Migration 0046 backfilled a duplicate 'design_milling' row for every
--    catalog item (and 0047's seed script may have added 'milling_only' rows); the product is Design-only,
--    so they are removed here. client_price_list rows for them go with them (ON DELETE CASCADE).
--    The Design ('design_only') rows and every client's own Design prices are untouched.
DO $$ BEGIN
  -- Some databases already lost this column (an earlier "drop service_catalog.service_type" migration
  -- was applied by hand), in which case there is nothing to delete.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'service_catalog' AND column_name = 'service_type') THEN
    EXECUTE 'DELETE FROM "service_catalog" WHERE "service_type"::text <> ''design_only''';
  END IF;
END $$;
--> statement-breakpoint

-- 1. Milling tables (children first) and their enums
DROP TABLE IF EXISTS "case_center_assignment_history" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "milling_case_assignments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "milling_routing_rules" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "milling_service_catalog" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "milling_centers" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."assignment_action";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."assignment_role";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."assignment_scope";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."milling_status";--> statement-breakpoint

-- 2. profiles
DROP INDEX IF EXISTS "public"."profiles_milling_center_id_idx";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "milling_center_id";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "enabled_service_types";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "model_only_lab";--> statement-breakpoint

-- 3. cases + service_catalog: service_type / design_source
ALTER TABLE "cases" DROP COLUMN IF EXISTS "design_source";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN IF EXISTS "service_type";--> statement-breakpoint
ALTER TABLE "service_catalog" DROP CONSTRAINT IF EXISTS "service_catalog_category_sub_category_service_type_uniq";--> statement-breakpoint
ALTER TABLE "service_catalog" DROP COLUMN IF EXISTS "service_type";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_category_sub_category_uniq"
    UNIQUE("category", "sub_category");
-- UNIQUE constraints create a backing index, so a re-run raises duplicate_table
-- (42P07) rather than duplicate_object (42710) — catch both to stay idempotent.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."design_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."service_type";--> statement-breakpoint

-- 4. Recreate the enums without the milling values.
--    (Postgres cannot drop enum values: rename old, create new, retype columns, drop old.)

-- 4a. case_status  (used by cases.status)
ALTER TYPE "public"."case_status" RENAME TO "case_status_old";--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM (
  'scan_received', 'allocated_to_designer', 'scan_verified', 'scan_not_verified',
  'in_progress', 'internal_qc', 'submitted_to_client', 'on_hold', 'client_feedback',
  'approved', 'delivered', 'cancelled', 'change_requested', 'client_reject'
);--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" SET DATA TYPE "public"."case_status" USING "status"::text::"public"."case_status";--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "status" SET DEFAULT 'scan_received'::"public"."case_status";--> statement-breakpoint
DROP TYPE "public"."case_status_old";--> statement-breakpoint

-- 4b. user_type  (used by profiles.user_type, activity_logs.user_type)
ALTER TYPE "public"."user_type" RENAME TO "user_type_old";--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM ('lab_portal', 'admin_portal');--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "user_type" SET DATA TYPE "public"."user_type" USING "user_type"::text::"public"."user_type";--> statement-breakpoint
ALTER TABLE "activity_logs" ALTER COLUMN "user_type" SET DATA TYPE "public"."user_type" USING "user_type"::text::"public"."user_type";--> statement-breakpoint
DROP TYPE "public"."user_type_old";--> statement-breakpoint

-- 4c. user_role  (used by profiles.user_role, activity_logs.user_role)
ALTER TYPE "public"."user_role" RENAME TO "user_role_old";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM (
  'client', 'subuser', 'admin', 'qc', 'account_manager', 'designer', 'consultant'
);--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "user_role" SET DATA TYPE "public"."user_role" USING "user_role"::text::"public"."user_role";--> statement-breakpoint
ALTER TABLE "activity_logs" ALTER COLUMN "user_role" SET DATA TYPE "public"."user_role" USING "user_role"::text::"public"."user_role";--> statement-breakpoint
DROP TYPE "public"."user_role_old";
