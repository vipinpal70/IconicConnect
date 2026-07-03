export interface ProfileData {
  id: string;
  fullName: string | null;
  role: string;
  labName?: string | null;
  [key: string]: any;
}

const SESSION_KEY = 'iconic_user_profile'
const SESSION_TS  = 'iconic_user_profile_ts'
const LOCAL_KEY   = 'iconic_user_profile_local'
const LOCAL_TS    = 'iconic_user_profile_local_ts'
const SESSION_TTL = 10 * 60 * 1000  // 10 minutes
const LOCAL_TTL   = 60 * 60 * 1000  // 1 hour

function readStorage(storage: Storage, key: string, tsKey: string, ttl: number): ProfileData | null {
  try {
    const raw = storage.getItem(key)
    const ts  = storage.getItem(tsKey)
    if (raw && ts && Date.now() - parseInt(ts, 10) < ttl) {
      return JSON.parse(raw) as ProfileData
    }
  } catch { /* ignore */ }
  return null
}

function writeStorage(storage: Storage, key: string, tsKey: string, data: ProfileData) {
  try {
    storage.setItem(key, JSON.stringify(data))
    storage.setItem(tsKey, Date.now().toString())
  } catch { /* ignore quota errors */ }
}

function clearStorage(storage: Storage, key: string, tsKey: string) {
  try {
    storage.removeItem(key)
    storage.removeItem(tsKey)
  } catch { /* ignore */ }
}

/**
 * Fetches the user profile from /api/profile.
 * Cache hierarchy: sessionStorage (10 min) → localStorage (1 hr) → API (+ Redis on server)
 */
export async function fetchProfileWithCache(): Promise<ProfileData | null> {
  if (typeof window === 'undefined') {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  const fromSession = readStorage(sessionStorage, SESSION_KEY, SESSION_TS, SESSION_TTL)
  if (fromSession) return fromSession

  const fromLocal = readStorage(localStorage, LOCAL_KEY, LOCAL_TS, LOCAL_TTL)
  if (fromLocal) {
    writeStorage(sessionStorage, SESSION_KEY, SESSION_TS, fromLocal)
    return fromLocal
  }

  try {
    const res = await fetch('/api/profile')
    if (!res.ok) return null
    const data: ProfileData = await res.json()

    writeStorage(sessionStorage, SESSION_KEY, SESSION_TS, data)
    writeStorage(localStorage, LOCAL_KEY, LOCAL_TS, data)

    return data
  } catch (err) {
    console.error('Error fetching profile:', err)
    return null
  }
}

/**
 * Clears the cached user profile from both sessionStorage and localStorage.
 * Call this after any profile update.
 */
export function invalidateProfileCache() {
  if (typeof window === 'undefined') return
  clearStorage(sessionStorage, SESSION_KEY, SESSION_TS)
  clearStorage(localStorage, LOCAL_KEY, LOCAL_TS)
}
