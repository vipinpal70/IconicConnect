-- Add client-payment and admin-receipt tracking to invoices

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_paid" boolean NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_payment_date" date;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "received" boolean NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "received_confirmation_id" varchar(100);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "received_on" date;
