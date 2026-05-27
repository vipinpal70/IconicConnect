ALTER TABLE "offer_claims" ADD COLUMN "status" varchar(50) DEFAULT 'claimed' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;