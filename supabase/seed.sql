-- supabase/seed.sql
-- Purpose: Seeds pricing tables with standard base rates for crown/bridge, implants, appliances, dentures, and cosmetics.
-- Authors: Antigravity AI

-- 1. Seed pricing_crown_bridge
INSERT INTO pricing_crown_bridge (sub_category, price) VALUES
  ('Crown', 5.00),
  ('Bridge', 5.00)
ON CONFLICT (sub_category) DO NOTHING;

-- 2. Seed pricing_implants
INSERT INTO pricing_implants (sub_category, type, base_price) VALUES
  ('Robotic', 'Crown', 5.00),
  ('Robotic', 'Bridge', 5.00),
  ('Custom', 'Crown', 5.00),
  ('Custom', 'Bridge', 5.00),
  ('Ti-Base', 'Crown', 5.00),
  ('Ti-Base', 'Bridge', 5.00),
  ('Ti-Base', 'On-Lay', 5.00)
ON CONFLICT (sub_category, type) DO NOTHING;

-- 3. Seed pricing_appliances
INSERT INTO pricing_appliances (appliance_type, occlusion_type, arch, total_price) VALUES
  -- Night Guards
  ('Night Guards', 'Even Occlusion', 'Upper', 5.00),
  ('Night Guards', 'Even Occlusion', 'Lower', 5.00),
  ('Night Guards', 'Even Occlusion', 'Both Arches', 10.00),
  ('Night Guards', 'Custom', 'Upper', 5.00),
  ('Night Guards', 'Custom', 'Lower', 5.00),
  ('Night Guards', 'Custom', 'Both Arches', 10.00),
  -- Spot Guards
  ('Spot Guards', 'Even Occlusion', 'Upper', 5.00),
  ('Spot Guards', 'Even Occlusion', 'Lower', 5.00),
  ('Spot Guards', 'Even Occlusion', 'Both Arches', 10.00),
  ('Spot Guards', 'Custom', 'Upper', 5.00),
  ('Spot Guards', 'Custom', 'Lower', 5.00),
  ('Spot Guards', 'Custom', 'Both Arches', 10.00),
  -- Sports Guard
  ('Sports Guard', NULL, 'Upper', 5.00),
  ('Sports Guard', NULL, 'Lower', 5.00),
  ('Sports Guard', NULL, 'Both Arches', 10.00),
  -- Mouth Guards
  ('Mouth Guards', NULL, 'Upper', 5.00),
  ('Mouth Guards', NULL, 'Lower', 5.00),
  ('Mouth Guards', NULL, 'Both Arches', 10.00),
  -- NTI
  ('NTI', NULL, 'Upper', 5.00),
  ('NTI', NULL, 'Lower', 5.00),
  ('NTI', NULL, 'Both Arches', 10.00)
ON CONFLICT DO NOTHING;

-- 4. Seed pricing_dentures (using cross-join of 5 sub_categories x 3 arches)
INSERT INTO pricing_dentures (sub_category, arch, base_price)
SELECT sub_cat, arch_val, 5.00
FROM
  unnest(ARRAY['Reference Denture','Copy Denture','Immediate Denture','Full Denture','Partial Denture']) as sub_cat,
  unnest(ARRAY['Upper','Lower','Both Arches']) as arch_val
ON CONFLICT (sub_category, arch) DO NOTHING;

-- 5. Seed pricing_cosmetics (using cross-join of 3 sub_categories x 3 arches)
INSERT INTO pricing_cosmetics (sub_category, arch, base_price)
SELECT sub_cat, arch_val, 5.00
FROM
  unnest(ARRAY['Digital Wax Up','Veneers','Snap on Smile']) as sub_cat,
  unnest(ARRAY['Upper','Lower','Both Arches']) as arch_val
ON CONFLICT (sub_category, arch) DO NOTHING;
