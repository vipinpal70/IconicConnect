-- Custom SQL migration file, put your code below! --
CREATE INDEX IF NOT EXISTS "profiles_created_by_idx" ON "profiles" ("created_by");
CREATE INDEX IF NOT EXISTS "sub_users_client_id_idx" ON "sub_users" ("client_id");
CREATE INDEX IF NOT EXISTS "offer_claims_client_id_idx" ON "offer_claims" ("client_id");
