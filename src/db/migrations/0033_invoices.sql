CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" varchar(50) UNIQUE NOT NULL,
  "client_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "subtotal" numeric(10, 2) NOT NULL DEFAULT 0,
  "tax_type" varchar(10) NOT NULL DEFAULT 'percent',
  "tax_value" numeric(10, 2) NOT NULL DEFAULT 0,
  "tax_amount" numeric(10, 2) NOT NULL DEFAULT 0,
  "discount_type" varchar(10) NOT NULL DEFAULT 'percent',
  "discount_value" numeric(10, 2) NOT NULL DEFAULT 0,
  "discount_amount" numeric(10, 2) NOT NULL DEFAULT 0,
  "extra_charges_type" varchar(10) NOT NULL DEFAULT 'percent',
  "extra_charges_value" numeric(10, 2) NOT NULL DEFAULT 0,
  "extra_charges_amount" numeric(10, 2) NOT NULL DEFAULT 0,
  "total" numeric(10, 2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "remarks" text,
  "terms_of_payment" varchar(100) DEFAULT '7 Days',
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_profiles_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" USING btree ("status");
