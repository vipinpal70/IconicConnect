import { db } from '@/src/db'
import { millingServiceCatalog } from '@/src/db/schema/milling'
import { getUnitPrice } from '@/src/lib/invoice'
import { and, eq } from 'drizzle-orm'

export interface MillingMarginInput {
  millingCenterId: string
  category: string
  subCategory: string
  clientId: string
}

export interface MillingMarginResult {
  partnerRate: number | null
  clientPrice: number
  margin: number | null
}

/**
 * Admin/analytics-only margin lookup: what the milling centre charges Iconic
 * (partnerRate) vs. what the dental lab pays (clientPrice, from the flat
 * Design+Milling price list — never computed from partnerRate). Neither
 * number is ever returned to the dental lab or the milling centre.
 */
export async function getMillingMargin(input: MillingMarginInput): Promise<MillingMarginResult> {
  const [rate] = await db
    .select({ partnerRate: millingServiceCatalog.partnerRate })
    .from(millingServiceCatalog)
    .where(
      and(
        eq(millingServiceCatalog.millingCenterId, input.millingCenterId),
        eq(millingServiceCatalog.category, input.category),
        eq(millingServiceCatalog.subCategory, input.subCategory)
      )
    )
    .limit(1)

  const partnerRate = rate ? parseFloat(String(rate.partnerRate)) : null
  const clientPrice = await getUnitPrice(input.clientId, input.category, input.subCategory, 'design_milling')

  return {
    partnerRate,
    clientPrice,
    margin: partnerRate !== null ? parseFloat((clientPrice - partnerRate).toFixed(2)) : null,
  }
}
