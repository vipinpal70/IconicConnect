CREATE TABLE "client_price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"service_name" varchar(200) NOT NULL,
	"price" integer NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_price_list_items" ADD CONSTRAINT "client_price_list_items_client_id_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_price_list_items_client_id_idx" ON "client_price_list_items" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "client_price_list_items_client_sort_idx" ON "client_price_list_items" USING btree ("client_id","sort_order");
