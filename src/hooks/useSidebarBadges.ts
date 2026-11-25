"use client"

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { usePollInterval } from '@/src/lib/live/client'

export type SidebarBadges = Record<string, boolean>

export const BADGES_KEY = ['sidebar-badges']
const NO_BADGES: SidebarBadges = {}

/**
 * Dots meaning "something new since you last opened this page". The others (notifications, support) are real
 * unread counts: opening the page doesn't clear them, reading does.
 */
const SEEN_BY_VISITING = new Set(['cases', 'clients', 'billing', 'offers', 'tutorials'])

export function useSidebarBadges() {
  const queryClient = useQueryClient()

  const { data: badges = NO_BADGES } = useQuery<SidebarBadges>({
    queryKey: BADGES_KEY,
    queryFn: async () => {
      const res = await fetch('/api/sidebar-badges')
      if (!res.ok) throw new Error('Failed to load badges') // keep the dots shown so far
      return res.json()
    },
    // Events keep the dots right; this is the safety net (and all there is while the connection is down)
    refetchInterval: usePollInterval(60_000),
    staleTime: 20_000,
  })

  /** The person is on this page. Does nothing unless its dot is on, so ordinary navigation costs no request. */
  const markSeen = useCallback(
    async (page: string) => {
      if (!SEEN_BY_VISITING.has(page)) return
      if (!queryClient.getQueryData<SidebarBadges>(BADGES_KEY)?.[page]) return
      // Off at once, here; the other dots don't change, so there is nothing to reload
      await queryClient.cancelQueries({ queryKey: BADGES_KEY })
      queryClient.setQueryData<SidebarBadges>(BADGES_KEY, (old) => ({ ...old, [page]: false }))
      await fetch('/api/sidebar-badges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page }),
      }).catch(() => {}) // the dot comes back on the next refresh, and this is tried again
    },
    [queryClient]
  )

  return { badges, markSeen }
}
