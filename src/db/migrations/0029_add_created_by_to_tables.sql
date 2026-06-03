ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
ALTER TABLE "tutorials" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
ALTER TABLE "client_price_list_items" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
ALTER TABLE "preference_forms" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
ALTER TABLE "support_callback_requests" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "profiles"("id");
