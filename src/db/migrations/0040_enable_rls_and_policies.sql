-- Helper function to check if the current authenticated user is active
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'active'
  );
END;
$$;
--> statement-breakpoint

-- Enable RLS on all tables
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sub_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_read_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tutorials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_callback_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "preference_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_catalog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_price_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Policies for profiles
-- Allow select for the user themselves or any active user
CREATE POLICY "profiles_select_policy" ON "profiles"
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_active_user());--> statement-breakpoint

-- Allow update for the user themselves if they are active
CREATE POLICY "profiles_update_policy" ON "profiles"
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() AND public.is_active_user())
  WITH CHECK (id = auth.uid() AND public.is_active_user());--> statement-breakpoint

-- Policies for all other tables allowing full access to active users
CREATE POLICY "sub_users_active_policy" ON "sub_users" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "cases_active_policy" ON "cases" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "case_files_active_policy" ON "case_files" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "case_messages_active_policy" ON "case_messages" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "activity_logs_active_policy" ON "activity_logs" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "notifications_active_policy" ON "notifications" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "notification_preferences_active_policy" ON "notification_preferences" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "chat_messages_active_policy" ON "chat_messages" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "chat_read_states_active_policy" ON "chat_read_states" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "tutorials_active_policy" ON "tutorials" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "offers_active_policy" ON "offers" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "offer_claims_active_policy" ON "offer_claims" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "support_tickets_active_policy" ON "support_tickets" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "support_callback_requests_active_policy" ON "support_callback_requests" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "preference_forms_active_policy" ON "preference_forms" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "service_catalog_active_policy" ON "service_catalog" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "client_price_list_active_policy" ON "client_price_list" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());--> statement-breakpoint
CREATE POLICY "invoices_active_policy" ON "invoices" FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());
