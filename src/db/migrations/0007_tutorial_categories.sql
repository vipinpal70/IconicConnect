ALTER TABLE "tutorials"
ADD COLUMN IF NOT EXISTS "category" varchar(40) DEFAULT 'Getting Started' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutorials_category_idx" ON "tutorials" USING btree ("category");
