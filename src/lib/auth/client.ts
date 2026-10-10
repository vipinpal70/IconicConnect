'use client'

/** Browser-side replacement for supabase/client: only the calls the UI actually makes. */
export function createClient() {
  return {
    auth: {
      async signOut() {
        await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {})
        return { error: null }
      },
      async getUser() {
        const res = await fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null)
        if (!res || !res.ok) return { data: { user: null }, error: { message: 'Unauthorized' } }
        return { data: { user: (await res.json()) as { id: string; email: string; role: string } }, error: null }
      },
    },
  }
}
