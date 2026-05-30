/**
 * src/lib/pricingDb.ts
 * Purpose: Server-side pricing lookup calling the get_case_price PostgreSQL RPC.
 * Authors: Antigravity AI
 */

import { createClient } from '@/src/lib/supabase/server'
import type { CasePricingInput } from '@/src/types/pricing'

export async function getCasePriceFromDb(input: CasePricingInput): Promise<number> {
  // createClient in server.ts is an async function
  const supabase = await createClient()

  const params = {
    p_category:       input.category,
    p_sub_category:   'subCategory' in input ? input.subCategory : null,
    p_type:           input.category === 'Implants' ? input.type : null,
    p_appliance_type: input.category === 'Appliances' ? input.applianceType : null,
    p_occlusion_type: input.category === 'Appliances' ? (input.occlusionType ?? null) : null,
    p_arch:           'arch' in input ? input.arch : null,
  }

  const { data, error } = await supabase.rpc('get_case_price', params)

  if (error) {
    console.error('[getCasePriceFromDb] RPC error:', error)
    throw new Error(`Price lookup failed: ${error.message}`)
  }

  return data as number
}
