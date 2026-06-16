CREATE TABLE "sidebar_seen_at" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "page_key" varchar(50) NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sidebar_seen_user_page_idx" UNIQUE ("user_id", "page_key")
);
--> statement-breakpoint
ALTER TABLE "sidebar_seen_at"
  ADD CONSTRAINT "sidebar_seen_at_user_id_profiles_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "sidebar_seen_user_idx" ON "sidebar_seen_at" ("user_id");
--> statement-breakpoint
ALTER TABLE "sidebar_seen_at" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sidebar_seen_at_self_manage"
  ON "sidebar_seen_at"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
