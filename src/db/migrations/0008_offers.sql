CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"brand" varchar(120) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"discount" varchar(120) NOT NULL,
	"valid_till" varchar(20) NOT NULL,
	"target_clients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sponsored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "offers_category_idx" ON "offers" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "offers_created_at_idx" ON "offers" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "offers_sponsored_idx" ON "offers" USING btree ("sponsored");
