CREATE TABLE IF NOT EXISTS "chat_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "approval_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_price_list_items" ADD COLUMN IF NOT EXISTS "sub_category" varchar(200) NOT NULL DEFAULT '';--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_read_states_case_user_idx" ON "chat_read_states" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_read_states_user_idx" ON "chat_read_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_case_id_idx" ON "chat_messages" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_case_created_at_idx" ON "chat_messages" USING btree ("case_id","created_at");
