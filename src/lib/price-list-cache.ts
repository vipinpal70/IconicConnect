import type { PriceListEntryFull } from './price-list'

const SESSION_KEY = (id: string) => `iconic_price_list_${id}`
const LOCAL_KEY = (id: string) => `iconic_price_list_local_${id}`
const TS_SUFFIX = '_ts'

const SESSION_TTL = 10 * 60 * 1000  // 10 minutes
const LOCAL_TTL = 60 * 60 * 1000    // 1 hour

function readStorage(storage: Storage, key: string, ttl: number): PriceListEntryFull[] | null {
  try {
    const raw = storage.getItem(key)
    const ts = storage.getItem(key + TS_SUFFIX)
    if (raw && ts && Date.now() - parseInt(ts, 10) < ttl) {
      return JSON.parse(raw) as PriceListEntryFull[]
    }
  } catch {
    // ignore
  }
  return null
}

function writeStorage(storage: Storage, key: string, data: PriceListEntryFull[]) {
  try {
    storage.setItem(key, JSON.stringify(data))
    storage.setItem(key + TS_SUFFIX, Date.now().toString())
  } catch {
    // ignore quota errors
  }
}

function clearStorage(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
    storage.removeItem(key + TS_SUFFIX)
  } catch {
    // ignore
  }
}

export async function fetchPriceListWithCache(profileId: string): Promise<PriceListEntryFull[]> {
  const sKey = SESSION_KEY(profileId)
  const lKey = LOCAL_KEY(profileId)

  if (typeof window !== 'undefined') {
    const fromSession = readStorage(sessionStorage, sKey, SESSION_TTL)
    if (fromSession) return fromSession

    const fromLocal = readStorage(localStorage, lKey, LOCAL_TTL)
    if (fromLocal) {
      writeStorage(sessionStorage, sKey, fromLocal)
      return fromLocal
    }
  }

  const res = await fetch('/api/client/price-list')
  if (!res.ok) return []
  const json = await res.json()
  const data: PriceListEntryFull[] = Array.isArray(json.data) ? json.data : []

  if (typeof window !== 'undefined') {
    writeStorage(sessionStorage, sKey, data)
    writeStorage(localStorage, lKey, data)
  }

  return data
}

export function invalidatePriceListCache(profileId: string) {
  if (typeof window === 'undefined') return
  clearStorage(sessionStorage, SESSION_KEY(profileId))
  clearStorage(localStorage, LOCAL_KEY(profileId))
}
