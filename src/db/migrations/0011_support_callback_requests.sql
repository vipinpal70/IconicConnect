CREATE TABLE "support_callback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"client_name" varchar(100) NOT NULL,
	"lab_name" varchar(150) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255) NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_callback_requests" ADD CONSTRAINT "support_callback_requests_client_id_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_callback_requests_client_id_idx" ON "support_callback_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "support_callback_requests_requested_at_idx" ON "support_callback_requests" USING btree ("requested_at");
