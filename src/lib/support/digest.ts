import { and, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, users } from '@/src/db/schema/profile'
import { supEmailDigests, supMessages, supReads, supTickets } from '@/src/db/schema/support'
import { loadPreferences } from '@/src/lib/notifications/preferences'
import { queueEmail } from '@/src/lib/queue/jobs'
import { escapeHtml } from '@/src/lib/security/html'
import { safeEmailLink } from '@/src/lib/notifications/email-template'
import { formatTicketNumber, isAgentRole, isCustomerRole, type SupportSide } from './constants'
import { personName } from './queries'
import { usersWithOpenStreams } from './realtime'

/**
 * Unread-message emails (support-system.md §10). Single chat messages never email on their own; once a
 * minute this job emails a summary of what someone hasn't read yet, when:
 *   - the message is at least 2 minutes old (time to read it live),
 *   - they don't have the app open (no live support stream),
 *   - they haven't been emailed about this conversation in the last 10 minutes,
 *   - they want "conversation updates" emails.
 * Who: the lab owner and the lab member who started it (agent replies); the assignee (lab messages).
 * Unassigned conversations already email every agent when they are created, so they get no digest.
 */

const GRACE_MS = 2 * 60_000
const THROTTLE_MS = 10 * 60_000
const LOOKBACK_MS = 24 * 60 * 60_000
const MAX_SHOWN = 3

interface Candidate {
  userId: string
  ticket: { id: string; number: number; subject: string }
  side: SupportSide
  messages: Array<{ seq: number; body: string; authorName: string }>
}

const excerpt = (s: string) => (s.length > 280 ? `${s.slice(0, 277)}…` : s)

function linkFor(role: string, ticketId: string) {
  const path = role === 'admin' ? '/admin/support' : isCustomerRole(role) ? '/client/support' : '/support'
  return safeEmailLink(`${path}?ticket=${ticketId}`)
}

export function renderDigest(c: Pick<Candidate, 'ticket' | 'messages'>, link: string | null) {
  const number = formatTicketNumber(c.ticket.number)
  const count = c.messages.length
  const subject = count === 1 ? `New reply in ${number}: ${c.ticket.subject}` : `${count} new messages in ${number}: ${c.ticket.subject}`
  const shown = c.messages.slice(-MAX_SHOWN)
  const items = shown
    .map(
      (m) => `<div style="border-left:3px solid #059669;padding:8px 12px;margin:0 0 12px 0;background:#f8fafc;">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">${escapeHtml(m.authorName)}</div>
        <div style="font-size:14px;color:#1f2937;white-space:pre-wrap;">${escapeHtml(excerpt(m.body || 'Sent an attachment'))}</div>
      </div>`,
    )
    .join('')
  const more = count > shown.length ? `<p style="font-size:13px;color:#64748b;">and ${count - shown.length} earlier message(s).</p>` : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f4f5;padding:32px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
    <div style="background:#0f172a;padding:20px;text-align:center;border-bottom:2px solid #059669;">
      <span style="font-size:18px;font-weight:bold;color:#fff;">IconicConnect support</span>
    </div>
    <div style="padding:28px;color:#1f2937;">
      <h2 style="font-size:17px;margin:0 0 4px 0;">${escapeHtml(c.ticket.subject)}</h2>
      <p style="font-size:12px;color:#64748b;margin:0 0 20px 0;">${number}</p>
      ${items}${more}
      ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:8px;background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">Reply in IconicConnect</a>` : ""}
    </div>
    <div style="background:#f8fafc;padding:14px;text-align:center;font-size:12px;color:#94a3b8;">
      You get this because a support conversation has unread messages. Turn off "conversation updates" emails in your notification preferences.
    </div>
  </div>
</body></html>`
  return { subject: subject.length > 200 ? `${subject.slice(0, 197)}…` : subject, html }
}

export async function sendEmailDigests(now = new Date()): Promise<{ sent: number }> {
  const since = new Date(now.getTime() - LOOKBACK_MS)
  const until = new Date(now.getTime() - GRACE_MS)

  const tickets = await db
    .select({ id: supTickets.id, number: supTickets.number, subject: supTickets.subject, clientId: supTickets.clientId, createdBy: supTickets.createdBy, assigneeId: supTickets.assigneeId })
    .from(supTickets)
    .where(gte(supTickets.lastMessageAt, since))
  if (tickets.length === 0) return { sent: 0 }
  const ticketIds = tickets.map((t) => t.id)

  const messages = await db
    .select({
      ticketId: supMessages.ticketId,
      seq: supMessages.seq,
      kind: supMessages.kind,
      body: supMessages.body,
      authorId: supMessages.authorId,
      authorFullName: profiles.fullName,
      authorLabName: profiles.labName,
      authorRole: profiles.role,
    })
    .from(supMessages)
    .leftJoin(profiles, sql`${profiles.id} = ${supMessages.authorId}`)
    .where(
      and(
        inArray(supMessages.ticketId, ticketIds),
        inArray(supMessages.kind, ['customer', 'agent']),
        isNull(supMessages.deletedAt),
        gte(supMessages.createdAt, since),
        lte(supMessages.createdAt, until),
      ),
    )
    .orderBy(supMessages.seq)
  if (messages.length === 0) return { sent: 0 }

  // Possible recipients and who they are
  const wanted = new Set<string>()
  for (const t of tickets) {
    wanted.add(t.clientId)
    if (t.createdBy) wanted.add(t.createdBy)
    if (t.assigneeId) wanted.add(t.assigneeId)
  }
  const people = new Map(
    (
      await db
        .select({ id: profiles.id, role: profiles.role, clientId: profiles.clientId, status: profiles.status, email: users.email })
        .from(profiles)
        .innerJoin(users, sql`${users.id} = ${profiles.id}`)
        .where(inArray(profiles.id, [...wanted]))
    ).map((p) => [p.id, p]),
  )

  const byTicket = new Map<string, typeof messages>()
  for (const m of messages) byTicket.set(m.ticketId, [...(byTicket.get(m.ticketId) ?? []), m])

  const candidates: Candidate[] = []
  for (const t of tickets) {
    const thread = byTicket.get(t.id)
    if (!thread) continue
    const recipients: Array<{ id: string; side: SupportSide }> = []
    for (const id of new Set([t.clientId, t.createdBy])) {
      const p = id ? people.get(id) : undefined
      if (p && isCustomerRole(p.role) && (p.clientId ?? p.id) === t.clientId) recipients.push({ id: p.id, side: 'customer' })
    }
    const assignee = t.assigneeId ? people.get(t.assigneeId) : undefined
    if (assignee && isAgentRole(assignee.role)) recipients.push({ id: assignee.id, side: 'agent' })

    for (const r of recipients) {
      if (people.get(r.id)?.status !== 'active') continue
      const fromOtherSide = thread.filter((m) => m.kind !== r.side && m.authorId !== r.id)
      if (fromOtherSide.length === 0) continue
      candidates.push({
        userId: r.id,
        ticket: t,
        side: r.side,
        messages: fromOtherSide.map((m) => ({
          seq: m.seq,
          body: m.body,
          authorName: personName({ fullName: m.authorFullName, labName: m.authorLabName, role: m.authorRole }),
        })),
      })
    }
  }
  if (candidates.length === 0) return { sent: 0 }

  // Drop what they've read or were already emailed about, and recent emails
  const userIds = [...new Set(candidates.map((c) => c.userId))]
  const candidateTicketIds = [...new Set(candidates.map((c) => c.ticket.id))]
  const key = (userId: string, ticketId: string) => `${userId}:${ticketId}`
  const [reads, digests] = await Promise.all([
    db.select().from(supReads).where(and(inArray(supReads.userId, userIds), inArray(supReads.ticketId, candidateTicketIds))),
    db.select().from(supEmailDigests).where(and(inArray(supEmailDigests.userId, userIds), inArray(supEmailDigests.ticketId, candidateTicketIds))),
  ])
  const readSeq = new Map(reads.map((r) => [key(r.userId, r.ticketId), r.lastReadSeq]))
  const digestOf = new Map(digests.map((d) => [key(d.userId, d.ticketId), d]))

  const due: Candidate[] = []
  for (const c of candidates) {
    const k = key(c.userId, c.ticket.id)
    const previous = digestOf.get(k)
    if (previous && now.getTime() - previous.lastSentAt.getTime() < THROTTLE_MS) continue
    const after = Math.max(readSeq.get(k) ?? 0, previous?.lastSeq ?? 0)
    const unread = c.messages.filter((m) => m.seq > after)
    if (unread.length > 0) due.push({ ...c, messages: unread })
  }
  if (due.length === 0) return { sent: 0 }

  const [online, prefs] = await Promise.all([usersWithOpenStreams([...new Set(due.map((c) => c.userId))]), loadPreferences([...new Set(due.map((c) => c.userId))])])

  let sent = 0
  for (const c of due) {
    if (online.has(c.userId)) continue
    const pref = prefs.get(c.userId)
    if (!pref?.emailEnabled || pref.supportTicketUpdatedEmail === false) continue
    const person = people.get(c.userId)!
    const lastSeq = c.messages[c.messages.length - 1].seq

    // Claim the send atomically: a second worker (or a slow previous run) finds the row fresh and skips it
    const claimed = await db
      .insert(supEmailDigests)
      .values({ userId: c.userId, ticketId: c.ticket.id, lastSeq, lastSentAt: now })
      .onConflictDoUpdate({
        target: [supEmailDigests.userId, supEmailDigests.ticketId],
        set: { lastSeq, lastSentAt: now },
        setWhere: sql`${supEmailDigests.lastSentAt} <= ${new Date(now.getTime() - THROTTLE_MS).toISOString()}::timestamptz`,
      })
      .returning({ userId: supEmailDigests.userId })
    if (claimed.length === 0) continue

    const { subject, html } = renderDigest(c, linkFor(person.role ?? '', c.ticket.id))
    try {
      await queueEmail({ to: person.email, subject, html, type: 'notification' })
      sent++
    } catch (error) {
      console.error('[support digest] could not queue email', error)
    }
  }
  return { sent }
}
