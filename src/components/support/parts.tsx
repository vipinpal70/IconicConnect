'use client'

import { Fragment } from 'react'
import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns'
import { cn } from '@/src/lib/utils'
import {
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type SupportPriority,
  type SupportSide,
  type SupportStatus,
} from '@/src/lib/support/constants'

export function relativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return 'now'
  return formatDistanceToNowStrict(date, { addSuffix: false })
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y')
}

export function clockTime(iso: string): string {
  return format(new Date(iso), 'p')
}

export function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEE, d MMM yyyy')
}

export function StatusBadge({ status, className }: { status: SupportStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold', STATUS_STYLES[status], className)}>
      {STATUS_LABELS[status]}
    </span>
  )
}

/** "Waiting on …" is derived from who spoke last; it is a hint, not a status. */
export function WaitingBadge({
  status,
  lastPublicSender,
  viewerSide,
}: {
  status: SupportStatus
  lastPublicSender: SupportSide | null
  viewerSide: SupportSide
}) {
  if (status === 'closed' || !lastPublicSender) return null
  const waitingOnYou = lastPublicSender !== viewerSide
  const label =
    viewerSide === 'agent'
      ? lastPublicSender === 'customer' ? 'Waiting on support' : 'Waiting on lab'
      : lastPublicSender === 'agent' ? 'Support replied' : 'Waiting on support'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium',
        waitingOnYou ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

export function PriorityLabel({ priority }: { priority: SupportPriority }) {
  if (priority === 'normal') return null
  return <span className={cn('text-[10px] uppercase tracking-wide', PRIORITY_STYLES[priority])}>{PRIORITY_LABELS[priority]}</span>
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

/** Plain text with clickable http(s) links. Never renders HTML from the message. */
export function MessageText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 break-all">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}
