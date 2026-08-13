-- 3D Model case category (see 3d-model-implement-plan.md).
-- Lab restriction flag: when true, this client/lab may only create "3D Model"
-- category cases — enforced in POST /api/cases and the case-creation UI.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "model_only_lab" boolean DEFAULT false NOT NULL;
