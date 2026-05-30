-- supabase/migrations/20260530134641_create_service_pricing.sql
-- Purpose: Scaffolds the Service Pricing Schema, tables, triggers, and helper functions.
-- Authors: Antigravity AI

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reusable trigger function for auto-updating updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Table: pricing_crown_bridge
CREATE TABLE pricing_crown_bridge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_category TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_cb_sub_category CHECK (sub_category IN ('Crown', 'Bridge')),
  CONSTRAINT uq_cb_sub_category UNIQUE (sub_category)
);

CREATE TRIGGER set_updated_at_pricing_crown_bridge
BEFORE UPDATE ON pricing_crown_bridge
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 2. Table: pricing_implants
CREATE TABLE pricing_implants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_category TEXT NOT NULL,
  type TEXT NOT NULL,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_implant_sub_category CHECK (sub_category IN ('Robotic', 'Custom', 'Ti-Base')),
  CONSTRAINT chk_implant_type CHECK (type IN ('Crown', 'Bridge', 'On-Lay')),
  CONSTRAINT uq_implant_sub_category_type UNIQUE (sub_category, type)
);

CREATE TRIGGER set_updated_at_pricing_implants
BEFORE UPDATE ON pricing_implants
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 3. Function: get_implant_price
CREATE OR REPLACE FUNCTION get_implant_price(p_sub_category TEXT, p_type TEXT)
RETURNS DECIMAL(10,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_base_price DECIMAL(10,2);
  v_cb_type TEXT;
  v_cb_price DECIMAL(10,2);
BEGIN
  -- On-Lay maps to Crown key for lookup
  IF p_type = 'On-Lay' THEN
    v_cb_type := 'Crown';
  ELSE
    v_cb_type := p_type;
  END IF;

  SELECT base_price INTO v_base_price
  FROM pricing_implants
  WHERE sub_category = p_sub_category AND type = p_type;

  SELECT price INTO v_cb_price
  FROM pricing_crown_bridge
  WHERE sub_category = v_cb_type;

  RETURN COALESCE(v_base_price, 0.00) + COALESCE(v_cb_price, 0.00);
END;
$$;

-- 4. Table: pricing_appliances
CREATE TABLE pricing_appliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appliance_type TEXT NOT NULL,
  occlusion_type TEXT NULL,
  arch TEXT NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_appliance_type CHECK (appliance_type IN ('Night Guards', 'Spot Guards', 'Sports Guard', 'Mouth Guards', 'NTI')),
  CONSTRAINT chk_appliance_arch CHECK (arch IN ('Upper', 'Lower', 'Both Arches')),
  CONSTRAINT chk_appliance_occlusion CHECK (occlusion_type IN ('Even Occlusion', 'Custom') OR occlusion_type IS NULL)
);

-- Partial unique indexes for appliances (because NULL != NULL in standard UNIQUE constraints)
CREATE UNIQUE INDEX uq_appliances_with_occlusion
  ON pricing_appliances (appliance_type, occlusion_type, arch)
  WHERE occlusion_type IS NOT NULL;

CREATE UNIQUE INDEX uq_appliances_no_occlusion
  ON pricing_appliances (appliance_type, arch)
  WHERE occlusion_type IS NULL;

CREATE TRIGGER set_updated_at_pricing_appliances
BEFORE UPDATE ON pricing_appliances
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 5. Table: pricing_dentures
CREATE TABLE pricing_dentures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_category TEXT NOT NULL,
  arch TEXT NOT NULL,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  arch_price DECIMAL(10,2) GENERATED ALWAYS AS (CASE arch WHEN 'Both Arches' THEN 10.00 ELSE 5.00 END) STORED,
  total_price DECIMAL(10,2) GENERATED ALWAYS AS (base_price + CASE arch WHEN 'Both Arches' THEN 10.00 ELSE 5.00 END) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_denture_arch CHECK (arch IN ('Upper', 'Lower', 'Both Arches')),
  CONSTRAINT chk_denture_sub_category CHECK (sub_category IN ('Reference Denture', 'Copy Denture', 'Immediate Denture', 'Full Denture', 'Partial Denture')),
  CONSTRAINT uq_denture_sub_category_arch UNIQUE (sub_category, arch)
);

CREATE TRIGGER set_updated_at_pricing_dentures
BEFORE UPDATE ON pricing_dentures
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 6. Table: pricing_cosmetics
CREATE TABLE pricing_cosmetics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_category TEXT NOT NULL,
  arch TEXT NOT NULL,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  arch_price DECIMAL(10,2) GENERATED ALWAYS AS (CASE arch WHEN 'Both Arches' THEN 10.00 ELSE 5.00 END) STORED,
  total_price DECIMAL(10,2) GENERATED ALWAYS AS (base_price + CASE arch WHEN 'Both Arches' THEN 10.00 ELSE 5.00 END) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_cosmetic_arch CHECK (arch IN ('Upper', 'Lower', 'Both Arches')),
  CONSTRAINT chk_cosmetic_sub_category CHECK (sub_category IN ('Digital Wax Up', 'Veneers', 'Snap on Smile')),
  CONSTRAINT uq_cosmetic_sub_category_arch UNIQUE (sub_category, arch)
);

CREATE TRIGGER set_updated_at_pricing_cosmetics
BEFORE UPDATE ON pricing_cosmetics
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 7. Master function: get_case_price
CREATE OR REPLACE FUNCTION get_case_price(
  p_category TEXT,
  p_sub_category TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_appliance_type TEXT DEFAULT NULL,
  p_occlusion_type TEXT DEFAULT NULL,
  p_arch TEXT DEFAULT NULL
)
RETURNS DECIMAL(10,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_price DECIMAL(10,2) := 0.00;
BEGIN
  CASE p_category
    WHEN 'Crown & Bridge' THEN
      SELECT price INTO v_price
      FROM pricing_crown_bridge
      WHERE sub_category = p_sub_category;

    WHEN 'Implants' THEN
      v_price := get_implant_price(p_sub_category, p_type);

    WHEN 'Appliances' THEN
      SELECT total_price INTO v_price
      FROM pricing_appliances
      WHERE appliance_type = p_appliance_type
        AND arch = p_arch
        AND (occlusion_type = p_occlusion_type OR (occlusion_type IS NULL AND p_occlusion_type IS NULL));

    WHEN 'Dentures' THEN
      SELECT total_price INTO v_price
      FROM pricing_dentures
      WHERE sub_category = p_sub_category AND arch = p_arch;

    WHEN 'Cosmetics' THEN
      SELECT total_price INTO v_price
      FROM pricing_cosmetics
      WHERE sub_category = p_sub_category AND arch = p_arch;

    ELSE
      v_price := 0.00;
  END CASE;

  RETURN COALESCE(v_price, 0.00);
END;
$$;

-- 8. Row Level Security & Policies
ALTER TABLE pricing_crown_bridge ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_implants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_appliances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_dentures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_cosmetics ENABLE ROW LEVEL SECURITY;

-- Helper to check if user has admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

-- SELECT is public for price lookup
CREATE POLICY "Allow public read access to pricing_crown_bridge" ON pricing_crown_bridge FOR SELECT USING (true);
CREATE POLICY "Allow public read access to pricing_implants" ON pricing_implants FOR SELECT USING (true);
CREATE POLICY "Allow public read access to pricing_appliances" ON pricing_appliances FOR SELECT USING (true);
CREATE POLICY "Allow public read access to pricing_dentures" ON pricing_dentures FOR SELECT USING (true);
CREATE POLICY "Allow public read access to pricing_cosmetics" ON pricing_cosmetics FOR SELECT USING (true);

-- Admin only write policies (service_role bypasses RLS automatically)
CREATE POLICY "Allow write access for admins on pricing_crown_bridge" ON pricing_crown_bridge FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Allow write access for admins on pricing_implants" ON pricing_implants FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Allow write access for admins on pricing_appliances" ON pricing_appliances FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Allow write access for admins on pricing_dentures" ON pricing_dentures FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Allow write access for admins on pricing_cosmetics" ON pricing_cosmetics FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
