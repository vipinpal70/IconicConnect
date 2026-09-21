import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters, millingServiceCatalog } from '@/src/db/schema/milling'
import { resolveCaseSubCategory } from '@/src/lib/pricing'
import type { ServiceType } from '@/src/lib/case-status-mapping'

export type EligibleCenter = {
  id: string
  name: string
  partnerRate: string
  unitType: string
  turnaroundDays: number | null
}

/**
 * Centres eligible to take on a case with this category/subTypeData/serviceType
 * — case-flow-update-plan.md §9. Eligibility never depends on whether the
 * centre is being picked for the *design* leg or the *milling* leg: both are
 * gated by the same two checks against the case's own serviceType, since a
 * centre enabled for "Design + Milling" is, by definition, allowed to design
 * a design_milling case whether or not it ends up also milling that
 * particular case. There is deliberately no separate "design-only-within-a-
 * design_milling-case" bucket.
 *
 * 1. `serviceType` is in the centre's `enabledServiceTypes`.
 * 2. An *active* `milling_service_catalog` row exists for this exact
 *    (centre, serviceType, category, subCategory) — the centre has priced
 *    this restoration under this flow, not just switched the flow on.
 *
 * Used by both the design-assignment picker and the production-assignment
 * picker (fixing the pre-existing gap where the production picker showed
 * every active centre regardless of enablement/pricing).
 */
export async function getEligibleCenters(params: {
  category: string
  subTypeData: unknown
  serviceType: ServiceType
}): Promise<EligibleCenter[]> {
  const subCategory = resolveCaseSubCategory(params.category, params.subTypeData)
  if (!subCategory) return []

  const rows = await db
    .select({
      id: millingCenters.id,
      name: millingCenters.name,
      enabledServiceTypes: millingCenters.enabledServiceTypes,
      partnerRate: millingServiceCatalog.partnerRate,
      unitType: millingServiceCatalog.unitType,
      turnaroundDays: millingServiceCatalog.turnaroundDays,
    })
    .from(millingServiceCatalog)
    .innerJoin(millingCenters, eq(millingCenters.id, millingServiceCatalog.millingCenterId))
    .where(
      and(
        eq(millingServiceCatalog.serviceType, params.serviceType),
        eq(millingServiceCatalog.category, params.category),
        eq(millingServiceCatalog.subCategory, subCategory),
        eq(millingServiceCatalog.isActive, true),
        eq(millingCenters.active, true)
      )
    )

  return rows
    .filter((r) => (r.enabledServiceTypes ?? []).includes(params.serviceType))
    .map((r) => ({
      id: r.id,
      name: r.name,
      partnerRate: r.partnerRate,
      unitType: r.unitType,
      turnaroundDays: r.turnaroundDays,
    }))
}

export async function isCenterEligible(params: {
  centerId: string
  category: string
  subTypeData: unknown
  serviceType: ServiceType
}): Promise<boolean> {
  const eligible = await getEligibleCenters(params)
  return eligible.some((c) => c.id === params.centerId)
}
