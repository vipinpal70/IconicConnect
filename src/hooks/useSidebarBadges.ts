"use client"

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export type SidebarBadges = Record<string, boolean>

export function useSidebarBadges() {
  const queryClient = useQueryClient()

  const { data: badges = {} } = useQuery<SidebarBadges>({
    queryKey: ['sidebar-badges'],
    queryFn: async () => {
      const res = await fetch('/api/sidebar-badges')
      if (!res.ok) return {}
      return res.json()
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const markSeen = useCallback(
    async (page: string) => {
      await fetch('/api/sidebar-badges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page }),
      })
      queryClient.invalidateQueries({ queryKey: ['sidebar-badges'] })
    },
    [queryClient]
  )

  return { badges, markSeen }
}
