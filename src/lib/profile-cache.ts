export interface ProfileData {
  id: string;
  fullName: string | null;
  role: string;
  labName?: string | null;
  [key: string]: any;
}

/**
 * Fetches the user profile from /api/profile and caches it in sessionStorage for 10 minutes
 * to avoid unnecessary API requests and reduce re-renders.
 */
export async function fetchProfileWithCache(): Promise<ProfileData | null> {
  if (typeof window === "undefined") {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  const CACHE_KEY = "iconic_user_profile";
  const TIMESTAMP_KEY = "iconic_user_profile_timestamp";
  const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

  try {
    const cachedData = sessionStorage.getItem(CACHE_KEY);
    const cachedTime = sessionStorage.getItem(TIMESTAMP_KEY);
    const now = Date.now();

    if (cachedData && cachedTime && (now - parseInt(cachedTime, 10)) < CACHE_DURATION) {
      return JSON.parse(cachedData);
    }
  } catch (e) {
    console.error("Error reading profile cache:", e);
  }

  try {
    const res = await fetch("/api/profile");
    if (!res.ok) return null;
    const data = await res.json();

    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
      sessionStorage.setItem(TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
      console.error("Error writing profile cache:", e);
    }

    return data;
  } catch (err) {
    console.error("Error fetching profile:", err);
    return null;
  }
}

/**
 * Invalidates the cached user profile. Call this after a profile update.
 */
export function invalidateProfileCache() {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("iconic_user_profile");
      sessionStorage.removeItem("iconic_user_profile_timestamp");
    } catch (e) {
      console.error("Error invalidating profile cache:", e);
    }
  }
}
