'use client'

import { toast } from 'sonner'
import { ChevronDown, Loader2, UserCheck } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu'
import {
  CATEGORY_LABELS,
  CLOSE_REASON_LABELS,
  PRIORITY_LABELS,
  SUPPORT_CATEGORIES,
  SUPPORT_CLOSE_REASONS,
  SUPPORT_PRIORITIES,
} from '@/src/lib/support/constants'
import type { TicketDetail } from '@/src/lib/support/types'
import { useAgents, useTicketAction, type ActionBody } from './api'

const UNASSIGNED = '__unassigned__'

/** Triage bar for agents: assignment, priority, category, close/reopen. Only shows allowed actions. */
export function AgentControls({ ticket }: { ticket: TicketDetail }) {
  const { data: agents = [] } = useAgents(true)
  const action = useTicketAction(ticket.id)
  const can = (a: TicketDetail['actions'][number]) => ticket.actions.includes(a)

  const run = (body: ActionBody, success?: string) =>
    action.mutate(body, {
      onSuccess: () => success && toast.success(success),
      onError: (error) => toast.error(error.message),
    })

  const busy = action.isPending

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2 sm:px-5">
      {can('assign') && (
        <Select
          value={ticket.assignee?.id ?? UNASSIGNED}
          disabled={busy}
          onValueChange={(value) => run({ action: 'assign', assigneeId: value === UNASSIGNED ? null : value }, 'Assignment updated')}
        >
          <SelectTrigger className="h-7 w-[170px] text-[11px]" aria-label="Assignee">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED} className="text-xs">Unassigned</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {can('claim') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ action: 'claim' }, 'Assigned to you')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
        >
          <UserCheck className="h-3.5 w-3.5" aria-hidden /> Take it
        </button>
      )}
      {can('set_priority') && (
        <Select value={ticket.priority} disabled={busy} onValueChange={(value) => run({ action: 'set_priority', priority: value as never })}>
          <SelectTrigger className="h-7 w-[110px] text-[11px]" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{PRIORITY_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {can('set_category') && (
        <Select value={ticket.category} disabled={busy} onValueChange={(value) => run({ action: 'set_category', category: value as never })}>
          <SelectTrigger className="h-7 w-[150px] text-[11px]" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">{CATEGORY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="ml-auto flex items-center gap-2">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        {can('close') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background hover:bg-foreground/90 disabled:opacity-60"
              >
                Close <ChevronDown className="h-3 w-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SUPPORT_CLOSE_REASONS.map((reason) => (
                <DropdownMenuItem key={reason} className="text-xs" onSelect={() => run({ action: 'close', reason }, 'Conversation closed')}>
                  Close as {CLOSE_REASON_LABELS[reason].toLowerCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {can('reopen') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ action: 'reopen' }, 'Conversation reopened')}
            className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}
