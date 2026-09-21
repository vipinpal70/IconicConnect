-- Design-partner case flow (case-flow-update-plan.md). Lets a Design+Milling
-- centre act as the *designer* on a case, not just the manufacturer, and
-- optionally commit up front to also milling it once design is approved.
--
-- New enum types (guarded — DO $$ ... EXCEPTION pattern, matching
-- 0046_milling_schema.sql, since CREATE TYPE has no IF NOT EXISTS):
DO $$ BEGIN
  CREATE TYPE "assignment_scope" AS ENUM('design', 'milling', 'design_milling');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "assignment_role" AS ENUM('design', 'milling');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "assignment_action" AS ENUM('assigned', 'reassigned', 'withdrawn', 'auto_advanced');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "design_source" AS ENUM('internal', 'partner');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- cases.design_source — denormalized "who's designing this" flag, defaults
-- to 'internal' so every existing case is unaffected.
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "design_source" "design_source" DEFAULT 'internal' NOT NULL;--> statement-breakpoint

-- milling_case_assignments: split the single millingCenterId into an
-- independent design leg and production leg, plus the Flow-3 auto-advance
-- flag and per-leg timestamps.
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "design_center_id" uuid;--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "production_center_id" uuid;--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "scope" "assignment_scope";--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "auto_advance_to_milling" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "design_assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ADD COLUMN IF NOT EXISTS "production_assigned_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "milling_case_assignments" ADD CONSTRAINT "milling_case_assignments_design_center_id_milling_centers_id_fk" FOREIGN KEY ("design_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "milling_case_assignments" ADD CONSTRAINT "milling_case_assignments_production_center_id_milling_centers_id_fk" FOREIGN KEY ("production_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Backfill: every row that existed before this migration is a production-only
-- assignment (today's only case — Flow 2 / milling_only). Never touches a row
-- that's already been backfilled (idempotent re-run).
UPDATE "milling_case_assignments"
SET "production_center_id" = "milling_center_id",
    "scope" = 'milling',
    "production_assigned_at" = "assigned_at"
WHERE "production_center_id" IS NULL;--> statement-breakpoint

ALTER TABLE "milling_case_assignments" ALTER COLUMN "scope" SET DEFAULT 'milling';--> statement-breakpoint
ALTER TABLE "milling_case_assignments" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint

-- A design-stage-only assignment has no production status yet.
ALTER TABLE "milling_case_assignments" ALTER COLUMN "milling_status" DROP NOT NULL;--> statement-breakpoint

-- Superseded by design_center_id / production_center_id and
-- design_assigned_at / production_assigned_at.
DROP INDEX IF EXISTS "milling_case_assignments_center_id_idx";--> statement-breakpoint
ALTER TABLE "milling_case_assignments" DROP COLUMN IF EXISTS "milling_center_id";--> statement-breakpoint
ALTER TABLE "milling_case_assignments" DROP COLUMN IF EXISTS "assigned_at";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "milling_case_assignments_design_center_id_idx" ON "milling_case_assignments" ("design_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milling_case_assignments_production_center_id_idx" ON "milling_case_assignments" ("production_center_id");--> statement-breakpoint

-- Append-only audit trail — case-flow-update-plan.md §5.1a.
CREATE TABLE IF NOT EXISTS "case_center_assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"role" "assignment_role" NOT NULL,
	"action" "assignment_action" NOT NULL,
	"milling_center_id" uuid,
	"previous_center_id" uuid,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_center_assignment_history" ADD CONSTRAINT "case_center_assignment_history_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_center_assignment_history" ADD CONSTRAINT "case_center_assignment_history_milling_center_id_milling_centers_id_fk" FOREIGN KEY ("milling_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_center_assignment_history" ADD CONSTRAINT "case_center_assignment_history_previous_center_id_milling_centers_id_fk" FOREIGN KEY ("previous_center_id") REFERENCES "public"."milling_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "case_center_assignment_history" ADD CONSTRAINT "case_center_assignment_history_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_center_assignment_history_case_id_idx" ON "case_center_assignment_history" ("case_id");
