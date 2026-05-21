CREATE TABLE IF NOT EXISTS "preference_forms" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_id" uuid NOT NULL,
  "form_name" varchar(150) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preference_forms" ADD CONSTRAINT "preference_forms_client_id_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preference_forms_client_idx" ON "preference_forms" USING btree ("client_id");
