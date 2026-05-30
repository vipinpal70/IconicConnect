/**
 * src/lib/supabase/types/database.types.ts
 * Purpose: Defines database row, insert, update types, and RPC function types for pricing.
 * Authors: Antigravity AI
 */

import type {
  PricingCrownBridge,
  PricingImplant,
  PricingAppliance,
  PricingDenture,
  PricingCosmetic,
} from '@/src/types/pricing'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      pricing_crown_bridge: {
        Row: PricingCrownBridge
        Insert: Omit<PricingCrownBridge, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PricingCrownBridge, 'id' | 'created_at'>>
      }
      pricing_implants: {
        Row: PricingImplant
        Insert: Omit<PricingImplant, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PricingImplant, 'id' | 'created_at'>>
      }
      pricing_appliances: {
        Row: PricingAppliance
        Insert: Omit<PricingAppliance, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PricingAppliance, 'id' | 'created_at'>>
      }
      pricing_dentures: {
        Row: PricingDenture
        Insert: Omit<PricingDenture, 'id' | 'created_at' | 'updated_at' | 'arch_price' | 'total_price'>
        Update: Partial<Pick<PricingDenture, 'base_price'>>
      }
      pricing_cosmetics: {
        Row: PricingCosmetic
        Insert: Omit<PricingCosmetic, 'id' | 'created_at' | 'updated_at' | 'arch_price' | 'total_price'>
        Update: Partial<Pick<PricingCosmetic, 'base_price'>>
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_case_price: {
        Args: {
          p_category: string
          p_sub_category?: string | null
          p_type?: string | null
          p_appliance_type?: string | null
          p_occlusion_type?: string | null
          p_arch?: string | null
        }
        Returns: number
      }
      get_implant_price: {
        Args: { p_sub_category: string; p_type: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
