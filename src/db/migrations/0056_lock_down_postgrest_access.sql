-- Security hardening: close the Supabase PostgREST / anon-key data path.
--
-- Background: 0040 enabled RLS but every policy was `FOR ALL … USING (is_active_user())`, i.e. ANY active
-- user could read AND write EVERY row of cases, invoices, client_price_list, chat, activity logs, etc.
-- through the public anon key — and `profiles_update_policy` let a user UPDATE their own profile row,
-- including `user_role`/`user_status` (self-promotion to admin).
--
-- The application never uses PostgREST for data: every read/write goes through Drizzle on DATABASE_URL
-- (a BYPASSRLS/owner role), after route-level authorization. The only browser/user-JWT reads are a user's
-- OWN profile row. So: drop all those policies, revoke table privileges from the API roles, and allow
-- exactly "select my own profile".
--
-- The pricing_* reference tables keep their existing read-only public policies (static price lookup data).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename NOT LIKE 'pricing\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;

  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE 'pricing\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- Sequences: nothing for API roles to do with them.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint

-- Future tables must not be auto-granted to the API roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
--> statement-breakpoint

-- The one thing user-JWT clients legitimately do: read their OWN profile row (sign-in redirect,
-- sidebar, /api/profile/[id]). Read-only; no INSERT/UPDATE/DELETE for API roles anywhere.
-- Remove legacy plaintext sub-user passwords that were stored in profiles.password.
UPDATE public.profiles SET password = NULL WHERE password IS NOT NULL;
--> statement-breakpoint
GRANT SELECT ON public.profiles TO authenticated;
--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());
