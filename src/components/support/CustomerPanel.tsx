'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { format } from 'date-fns'
import { Building2, FolderOpen, Mail, MessagesSquare, Phone, Star, Users } from 'lucide-react'
import { useCustomerContext } from './api'
import { StatusBadge, relativeTime } from './parts'

/** Who is this lab? Shown next to a conversation for agents (support-system.md §8). */
export function CustomerPanel({ clientId, ticketId }: { clientId: string; ticketId: string }) {
  const pathname = usePathname()
  const context = useCustomerContext(clientId, ticketId)
  // Admins have their own case pages; QC / account managers use the ops ones
  const caseHref = (id: string) => (pathname?.startsWith('/admin') ? `/admin/cases/${id}` : `/cases/${id}`)
  const ticketHref = (id: string) => `${pathname}?ticket=${id}`

  if (context.isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading lab details">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    )
  }
  if (context.error || !context.data) {
    return <p role="alert" className="p-4 text-xs text-muted-foreground">Lab details are unavailable right now.</p>
  }

  const { lab, cases, conversations, satisfaction } = context.data
  return (
    <div className="space-y-4 p-4 text-xs">
      <section aria-label="Lab">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-primary" aria-hidden /> {lab.name}
        </p>
        {lab.ownerName && lab.ownerName !== lab.name && <p className="mt-0.5 text-[11px] text-muted-foreground">Owner: {lab.ownerName}</p>}
        <dl className="mt-2 space-y-1 text-[11px]">
          {lab.email && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Email</dt>
              <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <dd><a href={`mailto:${lab.email}`} className="text-primary hover:underline">{lab.email}</a></dd>
            </div>
          )}
          {lab.phone && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Phone</dt>
              <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <dd><a href={`tel:${lab.phone}`} className="text-primary hover:underline">{lab.phone}</a></dd>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Members</dt>
            <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <dd>{lab.members} {lab.members === 1 ? 'person' : 'people'} · {lab.plan === 'onboarded' ? 'Onboarded' : lab.plan === 'trial' ? 'Trial' : 'No plan'} · {lab.status}</dd>
          </div>
          <div className="text-muted-foreground">Customer since {format(new Date(lab.memberSince), 'MMM yyyy')}</div>
        </dl>
      </section>

      <section aria-label="Cases">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Cases · {cases.open} open of {cases.total}
        </h3>
        {cases.recent.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No cases yet.</p>
        ) : (
          <ul className="space-y-1">
            {cases.recent.map((c) => (
              <li key={c.id}>
                <Link href={caseHref(c.id)} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
                  <span className="font-mono text-[11px]">{c.caseNumber}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{c.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Other conversations">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Other conversations · {conversations.open} open of {conversations.total}
        </h3>
        {conversations.recent.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">This is their first conversation.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.recent.map((t) => (
              <li key={t.id}>
                <Link href={ticketHref(t.id)} scroll={false} className="flex flex-col rounded px-1.5 py-1 hover:bg-muted/60">
                  <span className="truncate text-[11px] font-medium">{t.subject}</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{t.number}</span>
                    <StatusBadge status={t.status} />
                    {relativeTime(t.lastMessageAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Satisfaction">
        <h3 className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Star className="h-3.5 w-3.5" aria-hidden /> Satisfaction
        </h3>
        <p className="text-[11px]">
          {satisfaction.average === null ? (
            <span className="text-muted-foreground">No ratings yet</span>
          ) : (
            <>
              <span className="font-semibold">{satisfaction.average} / 5</span>{' '}
              <span className="text-muted-foreground">from {satisfaction.ratings} rating{satisfaction.ratings === 1 ? '' : 's'}</span>
            </>
          )}
        </p>
      </section>
    </div>
  )
}
