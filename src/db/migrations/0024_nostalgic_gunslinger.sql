ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "temp_password" varchar(255);--> statement-breakpoint
ALTER TABLE "client_price_list_items" ADD COLUMN IF NOT EXISTS "sub_category" varchar(200) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "password" varchar(255);--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "preferred_teeth_library" varchar(50) NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "teeth_library_file_url" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "teeth_library_file_name" varchar(255);