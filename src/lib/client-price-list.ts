import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, subUsers } from '@/src/db/schema/profile'

export interface PriceListItemInput {
  id?: string
  serviceName?: string
  price?: number | string
  notes?: string | null
  sortOrder?: number
}

export function normalizePriceListItems(items: PriceListItemInput[]) {
  return items
    .map((item, index) => {
      const serviceName = (item.serviceName ?? '').trim()
      if (!serviceName) {
        return null
      }

      const priceValue = typeof item.price === 'string' ? Number(item.price) : item.price
      if (!Number.isFinite(priceValue as number)) {
        throw new Error(`Invalid price for service "${serviceName}"`)
      }

      return {
        serviceName,
        price: Math.max(0, Math.round(priceValue as number)),
        notes: item.notes?.trim() || null,
        sortOrder: Number.isFinite(item.sortOrder ?? NaN) ? (item.sortOrder as number) : index,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

export async function resolveClientIdFromProfile(profileId: string, role: string) {
  if (role === 'client') {
    return profileId
  }

  if (role === 'subuser') {
    const [record] = await db.select().from(subUsers).where(eq(subUsers.profileId, profileId)).limit(1)
    return record?.clientId ?? null
  }

  return null
}

export async function getPriceListForClient(clientId: string) {
  const { clientPriceListItems } = await import('@/src/db/schema/client-price-list')

  return db
    .select()
    .from(clientPriceListItems)
    .where(eq(clientPriceListItems.clientId, clientId))
    .orderBy(clientPriceListItems.sortOrder, clientPriceListItems.createdAt)
}

export async function requireClientAccount(profileId: string, role: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1)
  if (!profile) {
    return null
  }

  const clientId = await resolveClientIdFromProfile(profile.id, role)
  if (!clientId) {
    return null
  }

  return { profile, clientId }
}
