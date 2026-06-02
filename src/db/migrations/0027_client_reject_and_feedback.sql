ALTER TYPE "public"."case_status" ADD VALUE IF NOT EXISTS 'client_reject';
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "client_massage" text;
