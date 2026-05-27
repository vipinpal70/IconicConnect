export const OFFER_CATEGORIES = [
  "Intraoral Scanner",
  "Materials",
  "Equipment",
  "Software",
  "Consumables",
] as const

export type OfferCategory = (typeof OFFER_CATEGORIES)[number]

export interface OfferRecord {
  id: string
  title: string
  brand: string
  category: OfferCategory
  description: string
  discount: string
  validTill: string
  targetClients: string[]
  targetLocations: string[]
  sponsored: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface OfferClaimRecord {
  id: string
  offerId: string
  clientId: string
  claimedAt: string
  offerTitle: string
  offerBrand: string
  offerDiscount: string
  clientName: string
  labName: string
  email: string
  phone: string
  status: string
}

export function isOfferCategory(value: string): value is OfferCategory {
  return (OFFER_CATEGORIES as readonly string[]).includes(value)
}
