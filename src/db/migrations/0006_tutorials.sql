CREATE TABLE "tutorials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"youtube_video_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tutorials_created_at_idx" ON "tutorials" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "tutorials_youtube_video_id_idx" ON "tutorials" USING btree ("youtube_video_id");
