'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  MessageView,
  MessagesResponse,
  PersonRef,
  SupportSummary,
  TicketDetail,
  TicketListResponse,
} from '@/src/lib/support/types'
import type { SupportCategory, SupportCloseReason, SupportPriority } from '@/src/lib/support/constants'

/**
 * Client data layer for the support UI. Phase 1 refreshes by polling; the live stream (Phase 3) will
 * push the same updates into these caches.
 */

export const POLL = { list: 30_000, ticket: 20_000, thread: 8_000 } as const

export class ApiError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
    throw new ApiError(res.status, body.code, body.error || 'Something went wrong. Please try again.')
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const supportKeys = {
  all: ['support'] as const,
  lists: ['support', 'list'] as const,
  list: (params: Record<string, string | undefined>) => ['support', 'list', params] as const,
  ticket: (id: string) => ['support', 'ticket', id] as const,
  messages: (id: string) => ['support', 'messages', id] as const,
  summary: ['support', 'summary'] as const,
  agents: ['support', 'agents'] as const,
  labs: ['support', 'labs'] as const,
}

export interface ListParams {
  view: string
  q?: string
  priority?: SupportPriority
  category?: SupportCategory
}

export function useTicketList(params: ListParams) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
  return useInfiniteQuery({
    queryKey: supportKeys.list(clean),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ ...clean, ...(pageParam ? { cursor: pageParam } : {}) })
      return request<TicketListResponse>(`/api/support/tickets?${search}`)
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: POLL.list,
  })
}

export function useTicket(ticketId: string | null) {
  return useQuery({
    queryKey: supportKeys.ticket(ticketId ?? 'none'),
    queryFn: () => request<TicketDetail>(`/api/support/tickets/${ticketId}`),
    enabled: Boolean(ticketId),
    refetchInterval: POLL.ticket,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}

export function useSupportSummary() {
  return useQuery({
    queryKey: supportKeys.summary,
    queryFn: () => request<SupportSummary>('/api/support/summary'),
    refetchInterval: POLL.list,
  })
}

export function useAgents(enabled: boolean) {
  return useQuery({
    queryKey: supportKeys.agents,
    queryFn: () => request<PersonRef[]>('/api/support/agents'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useLabs(enabled: boolean) {
  return useQuery({
    queryKey: supportKeys.labs,
    queryFn: () => request<PersonRef[]>('/api/admin/clients/options'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

function mergeMessages(existing: MessageView[], incoming: MessageView[]): MessageView[] {
  const bySeq = new Map(existing.map((m) => [m.seq, m]))
  for (const m of incoming) bySeq.set(m.seq, m)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * Thread messages, kept in the query cache: the newest page on open, then only messages newer than the
 * last one we have (cheap polling), and older pages on demand.
 */
export function useThreadMessages(ticketId: string | null) {
  const queryClient = useQueryClient()
  const key = supportKeys.messages(ticketId ?? 'none')

  const thread = useQuery({
    queryKey: key,
    queryFn: () => request<MessagesResponse>(`/api/support/tickets/${ticketId}/messages?limit=50`),
    enabled: Boolean(ticketId),
    staleTime: Infinity, // kept fresh by the incremental poll below
  })

  const fetchNewer = useCallback(async () => {
    const current = queryClient.getQueryData<MessagesResponse>(key)
    if (!ticketId || !current) return null
    const after = current.messages.at(-1)?.seq ?? 0
    const page = await request<MessagesResponse>(`/api/support/tickets/${ticketId}/messages?after=${after}&limit=100`)
    if (page.messages.length > 0) {
      queryClient.setQueryData<MessagesResponse>(key, (old) =>
        old ? { ...old, messages: mergeMessages(old.messages, page.messages) } : old,
      )
      // New messages usually mean the header changed too (status, assignee, read receipts)
      void queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) })
      void queryClient.invalidateQueries({ queryKey: supportKeys.lists })
    }
    return page.messages.length
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from ticketId
  }, [queryClient, ticketId])

  useQuery({
    queryKey: [...key, 'poll'],
    queryFn: fetchNewer,
    enabled: Boolean(ticketId) && thread.isSuccess,
    refetchInterval: POLL.thread,
  })

  const loadOlder = useCallback(async () => {
    const current = queryClient.getQueryData<MessagesResponse>(key)
    const first = current?.messages[0]?.seq
    if (!ticketId || !first) return
    const page = await request<MessagesResponse>(`/api/support/tickets/${ticketId}/messages?before=${first}&limit=50`)
    queryClient.setQueryData<MessagesResponse>(key, (old) =>
      old ? { messages: mergeMessages(old.messages, page.messages), hasMoreBefore: page.hasMoreBefore } : old,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from ticketId
  }, [queryClient, ticketId])

  const addMessage = useCallback(
    (message: MessageView) =>
      queryClient.setQueryData<MessagesResponse>(key, (old) =>
        old ? { ...old, messages: mergeMessages(old.messages, [message]) } : old,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from ticketId
    [queryClient, ticketId],
  )

  return { ...thread, loadOlder, fetchNewer, addMessage }
}

/**
 * Marks the thread read up to `seq` while it's actually on screen (tab visible), and again when the tab
 * becomes visible after messages arrived in the background. Refreshes badges afterwards.
 */
export function useMarkRead(ticketId: string | null, latestSeq: number | undefined) {
  const queryClient = useQueryClient()
  const sentRef = useRef<{ ticketId: string | null; seq: number }>({ ticketId: null, seq: 0 })

  useEffect(() => {
    if (!ticketId || !latestSeq) return
    const markIfVisible = () => {
      const sent = sentRef.current
      if (sent.ticketId === ticketId && sent.seq >= latestSeq) return
      if (document.visibilityState !== 'visible') return
      sentRef.current = { ticketId, seq: latestSeq }
      request(`/api/support/tickets/${ticketId}/read`, { method: 'POST', body: JSON.stringify({ seq: latestSeq }) })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: supportKeys.summary })
          void queryClient.invalidateQueries({ queryKey: supportKeys.lists })
          void queryClient.invalidateQueries({ queryKey: ['sidebar-badges'] })
        })
        .catch(() => {
          sentRef.current = sent // retry on the next change or visibility event
        })
    }
    markIfVisible()
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [queryClient, ticketId, latestSeq])
}

export function newClientMsgId(): string {
  return crypto.randomUUID()
}

export function sendMessage(ticketId: string, body: string, visibility: 'public' | 'note', clientMsgId: string) {
  return request<{ message: MessageView; created: boolean }>(`/api/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, visibility, clientMsgId }),
  })
}

export interface CreateTicketBody {
  subject: string
  category: SupportCategory
  message: string
  priority?: SupportPriority
  clientId?: string
  source?: 'page' | 'widget'
  clientMsgId: string
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTicketBody) =>
      request<{ ticketId: string; created: boolean }>('/api/support/tickets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.lists })
      void queryClient.invalidateQueries({ queryKey: supportKeys.summary })
    },
  })
}

export type ActionBody =
  | { action: 'close'; reason?: SupportCloseReason }
  | { action: 'reopen' }
  | { action: 'assign'; assigneeId: string | null }
  | { action: 'claim' }
  | { action: 'set_priority'; priority: SupportPriority }
  | { action: 'set_category'; category: SupportCategory }

export function useTicketAction(ticketId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ActionBody) =>
      request<TicketDetail>(`/api/support/tickets/${ticketId}/actions`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(supportKeys.ticket(ticketId), ticket)
      void queryClient.invalidateQueries({ queryKey: supportKeys.messages(ticketId) })
      void queryClient.invalidateQueries({ queryKey: supportKeys.lists })
      void queryClient.invalidateQueries({ queryKey: supportKeys.summary })
    },
  })
}
