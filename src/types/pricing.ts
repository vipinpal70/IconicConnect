/**
 * src/types/pricing.ts
 * Purpose: Export domain TypeScript types for Service Pricing schema.
 * Authors: Antigravity AI
 */

export type CrownBridgeSubCategory = 'Crown' | 'Bridge'

export type ImplantSubCategory = 'Robotic' | 'Custom' | 'Ti-Base'
export type ImplantType = 'Crown' | 'Bridge' | 'On-Lay'

export type ApplianceType = 'Night Guards' | 'Spot Guards' | 'Sports Guard' | 'Mouth Guards' | 'NTI'
export type OcclusionType = 'Even Occlusion' | 'Custom'
export type Arch = 'Upper' | 'Lower' | 'Both Arches'

export type DentureSubCategory =
  | 'Reference Denture'
  | 'Copy Denture'
  | 'Immediate Denture'
  | 'Full Denture'
  | 'Partial Denture'

export type CosmeticsSubCategory = 'Digital Wax Up' | 'Veneers' | 'Snap on Smile'

export type ServiceCategory = 'Crown & Bridge' | 'Implants' | 'Appliances' | 'Dentures' | 'Cosmetics'

// Discriminated union — one type per category
export type CasePricingInput =
  | { category: 'Crown & Bridge'; subCategory: CrownBridgeSubCategory }
  | { category: 'Implants'; subCategory: ImplantSubCategory; type: ImplantType }
  | { category: 'Appliances'; applianceType: ApplianceType; occlusionType?: OcclusionType; arch: Arch }
  | { category: 'Dentures'; subCategory: DentureSubCategory; arch: Arch }
  | { category: 'Cosmetics'; subCategory: CosmeticsSubCategory; arch: Arch }

export interface PricingCrownBridge {
  id: string
  sub_category: CrownBridgeSubCategory
  price: number
  created_at: string
  updated_at: string
}

export interface PricingImplant {
  id: string
  sub_category: ImplantSubCategory
  type: ImplantType
  base_price: number
  created_at: string
  updated_at: string
}

export interface PricingAppliance {
  id: string
  appliance_type: ApplianceType
  occlusion_type: OcclusionType | null
  arch: Arch
  total_price: number
  created_at: string
  updated_at: string
}

export interface PricingDenture {
  id: string
  sub_category: DentureSubCategory
  arch: Arch
  base_price: number
  arch_price: number      // generated column
  total_price: number     // generated column
  created_at: string
  updated_at: string
}

export interface PricingCosmetic {
  id: string
  sub_category: CosmeticsSubCategory
  arch: Arch
  base_price: number
  arch_price: number      // generated column
  total_price: number     // generated column
  created_at: string
  updated_at: string
}
