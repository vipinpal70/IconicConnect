CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"case_assigned_email" boolean DEFAULT true NOT NULL,
	"case_assigned_in_app" boolean DEFAULT true NOT NULL,
	"case_feedback_email" boolean DEFAULT true NOT NULL,
	"case_feedback_in_app" boolean DEFAULT true NOT NULL,
	"case_approved_email" boolean DEFAULT true NOT NULL,
	"case_approved_in_app" boolean DEFAULT true NOT NULL,
	"case_rejected_email" boolean DEFAULT true NOT NULL,
	"case_rejected_in_app" boolean DEFAULT true NOT NULL,
	"case_hold_email" boolean DEFAULT true NOT NULL,
	"case_hold_in_app" boolean DEFAULT true NOT NULL,
	"case_cancel_email" boolean DEFAULT true NOT NULL,
	"case_cancel_in_app" boolean DEFAULT true NOT NULL,
	"case_reminder_email" boolean DEFAULT true NOT NULL,
	"case_reminder_in_app" boolean DEFAULT true NOT NULL,
	"chat_message_email" boolean DEFAULT true NOT NULL,
	"chat_message_in_app" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "tutorials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"category" varchar(40) DEFAULT 'Getting Started' NOT NULL,
	"description" text NOT NULL,
	"youtube_video_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" varchar(255);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_client_id_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutorials_created_at_idx" ON "tutorials" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tutorials_category_idx" ON "tutorials" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tutorials_youtube_video_id_idx" ON "tutorials" USING btree ("youtube_video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_claims_offer_client_idx" ON "offer_claims" USING btree ("offer_id","client_id");--> statement-breakpoint
CREATE INDEX "offer_claims_created_at_idx" ON "offer_claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "offers_category_idx" ON "offers" USING btree ("category");--> statement-breakpoint
CREATE INDEX "offers_created_at_idx" ON "offers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "offers_sponsored_idx" ON "offers" USING btree ("sponsored");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_user_dismissed_idx" ON "notifications" USING btree ("user_id","is_dismissed");