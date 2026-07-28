import { db } from '@/src/db'
import { millingCenters, millingRoutingRules, millingCaseAssignments } from '@/src/db/schema/milling'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { MillingCenter, MillingRoutingRule } from '@/src/db/schema/milling'

export interface RoutingRuleScope {
  countries?: string[]
  states?: string[]
  excludeStates?: string[]
  clients?: string[]      // client profile ids
  products?: string[]     // case category, e.g. "Crown & Bridge"
  restorations?: string[] // case subCategory, e.g. "Zirconia Crown"
}

export interface RoutingContext {
  category?: string
  subCategory?: string
  clientId?: string
  state?: string
  country?: string
}

export interface RoutingCenterCandidate {
  center: MillingCenter
  currentLoad: number
}

export interface RoutingResult {
  primary: RoutingCenterCandidate | null
  fallback: RoutingCenterCandidate | null
  matchedRule: MillingRoutingRule | null
}

function ruleMatchesContext(scope: RoutingRuleScope, ctx: RoutingContext): boolean {
  if (scope.countries?.length && ctx.country && !scope.countries.includes(ctx.country)) return false
  if (scope.states?.length && ctx.state && !scope.states.includes(ctx.state)) return false
  if (scope.excludeStates?.length && ctx.state && scope.excludeStates.includes(ctx.state)) return false
  if (scope.clients?.length && ctx.clientId && !scope.clients.includes(ctx.clientId)) return false
  if (scope.products?.length && ctx.category && !scope.products.includes(ctx.category)) return false
  if (scope.restorations?.length && ctx.subCategory && !scope.restorations.includes(ctx.subCategory)) return false
  return true
}

/**
 * Load routing rules ordered by priority, find the first one whose scope
 * matches the given case context, and recommend a milling centre.
 *
 * Availability is "active" only — there is no capacity ceiling column on
 * milling_centers yet, so currentLoad is returned as informational context
 * for the admin, not used to gate the recommendation.
 */
export async function routeCase(ctx: RoutingContext): Promise<RoutingResult> {
  const rules = await db
    .select()
    .from(millingRoutingRules)
    .where(eq(millingRoutingRules.active, true))
    .orderBy(millingRoutingRules.priority)

  const matchedRule = rules.find((rule) => ruleMatchesContext(rule.scope as RoutingRuleScope, ctx)) ?? null

  if (!matchedRule) {
    return { primary: null, fallback: null, matchedRule: null }
  }

  const centerIds = [matchedRule.millingCenterId, matchedRule.fallbackMillingCenterId].filter(
    (id): id is string => Boolean(id)
  )

  const centers = centerIds.length
    ? await db.select().from(millingCenters).where(inArray(millingCenters.id, centerIds))
    : []

  const loadByCenter = await currentLoadByCenter(centerIds)

  const toCandidate = (centerId: string | null): RoutingCenterCandidate | null => {
    if (!centerId) return null
    const center = centers.find((c) => c.id === centerId)
    if (!center || !center.active) return null
    return { center, currentLoad: loadByCenter.get(centerId) ?? 0 }
  }

  const primaryCandidate = toCandidate(matchedRule.millingCenterId)
  const fallbackCandidate = toCandidate(matchedRule.fallbackMillingCenterId)

  // Primary is inactive/missing — the fallback centre becomes the recommendation.
  if (!primaryCandidate) {
    return { primary: fallbackCandidate, fallback: null, matchedRule }
  }

  return { primary: primaryCandidate, fallback: fallbackCandidate, matchedRule }
}

async function currentLoadByCenter(centerIds: string[]): Promise<Map<string, number>> {
  if (!centerIds.length) return new Map()

  const rows = await db
    .select({ millingCenterId: millingCaseAssignments.millingCenterId })
    .from(millingCaseAssignments)
    .where(
      and(
        inArray(millingCaseAssignments.millingCenterId, centerIds),
        ne(millingCaseAssignments.millingStatus, 'delivered')
      )
    )

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.millingCenterId, (counts.get(row.millingCenterId) ?? 0) + 1)
  }
  return counts
}
