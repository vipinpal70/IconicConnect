CREATE TABLE "offer_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL REFERENCES "offers"("id") ON DELETE cascade,
	"client_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "offer_claims_offer_client_idx" ON "offer_claims" USING btree ("offer_id","client_id");
--> statement-breakpoint
CREATE INDEX "offer_claims_created_at_idx" ON "offer_claims" USING btree ("created_at");
