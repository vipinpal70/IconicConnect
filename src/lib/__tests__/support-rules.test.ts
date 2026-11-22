import { describe, expect, it } from 'vitest'
import {
  allowedActions,
  canCreateTicketFor,
  canUseSupport,
  canViewTicket,
  checkPost,
  customerCanReopen,
  type SupportActor,
  type TicketAccess,
} from '@/src/lib/support/policy'
import { onAction, onPublicMessage, type LifecycleState } from '@/src/lib/support/lifecycle'
import { actionSchema, createTicketSchema, postMessageSchema } from '@/src/lib/support/validation'
import { formatTicketNumber } from '@/src/lib/support/constants'

const LAB_A = '11111111-1111-4111-8111-111111111111'
const LAB_B = '22222222-2222-4222-8222-222222222222'
const owner: SupportActor = { id: LAB_A, role: 'client', clientId: LAB_A }
const member: SupportActor = { id: '33333333-3333-4333-8333-333333333333', role: 'subuser', clientId: LAB_A }
const otherLab: SupportActor = { id: LAB_B, role: 'client', clientId: LAB_B }
const agent: SupportActor = { id: '44444444-4444-4444-8444-444444444444', role: 'qc', clientId: null }
const designer: SupportActor = { id: '55555555-5555-4555-8555-555555555555', role: 'designer', clientId: null }

const now = new Date('2026-11-22T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
const ticket = (over: Partial<TicketAccess> = {}): TicketAccess => ({ clientId: LAB_A, status: 'live', closedAt: null, assigneeId: null, ...over })

describe('support policy', () => {
  it('lets labs see only their own conversations, agents see all, designers nothing', () => {
    expect(canViewTicket(owner, ticket())).toBe(true)
    expect(canViewTicket(member, ticket())).toBe(true) // D2: sub-users see the whole lab
    expect(canViewTicket(otherLab, ticket())).toBe(false)
    expect(canViewTicket(agent, ticket())).toBe(true)
    expect(canViewTicket(designer, ticket())).toBe(false)
    expect(canUseSupport(designer)).toBe(false)
    expect(canUseSupport({ id: 'x', role: 'subuser', clientId: null })).toBe(false)
  })

  it('creates conversations only for your own lab, or any lab as an agent', () => {
    expect(canCreateTicketFor(member, LAB_A)).toBe(true)
    expect(canCreateTicketFor(member, LAB_B)).toBe(false)
    expect(canCreateTicketFor(agent, LAB_B)).toBe(true)
    expect(canCreateTicketFor(designer, LAB_A)).toBe(false)
  })

  it('keeps internal notes for agents', () => {
    expect(checkPost(agent, ticket(), 'note', now)).toEqual({ ok: true, reopens: false })
    expect(checkPost(owner, ticket(), 'note', now)).toEqual({ ok: false, code: 'notes_are_for_staff' })
  })

  it('reopens on a customer reply within 14 days, never after; agents can always reopen', () => {
    const recent = ticket({ status: 'closed', closedAt: daysAgo(13) })
    const old = ticket({ status: 'closed', closedAt: daysAgo(15) })
    expect(checkPost(owner, recent, 'public', now)).toEqual({ ok: true, reopens: true })
    expect(checkPost(owner, old, 'public', now)).toEqual({ ok: false, code: 'closed' })
    expect(checkPost(agent, old, 'public', now)).toEqual({ ok: true, reopens: true })
    expect(customerCanReopen(recent, now)).toBe(true)
    expect(customerCanReopen(old, now)).toBe(false)
  })

  it('hides other labs behind not_found (no existence leak)', () => {
    expect(checkPost(otherLab, ticket(), 'public', now)).toEqual({ ok: false, code: 'not_found' })
    expect(allowedActions(otherLab, ticket(), now)).toEqual([])
  })

  it('offers the right actions per side and status', () => {
    expect(allowedActions(owner, ticket(), now)).toEqual(['close'])
    expect(allowedActions(owner, ticket({ status: 'closed', closedAt: daysAgo(1) }), now)).toEqual(['reopen'])
    expect(allowedActions(owner, ticket({ status: 'closed', closedAt: daysAgo(30) }), now)).toEqual([])
    expect(allowedActions(agent, ticket(), now)).toEqual(['close', 'assign', 'set_priority', 'set_category', 'claim'])
    expect(allowedActions(agent, ticket({ assigneeId: agent.id }), now)).not.toContain('claim')
    expect(allowedActions(agent, ticket({ status: 'closed', closedAt: daysAgo(90) }), now)).toEqual(['reopen'])
  })
})

const state = (over: Partial<LifecycleState> = {}): LifecycleState => ({
  status: 'new',
  assigneeId: null,
  priority: 'normal',
  category: 'technical',
  firstRespondedAt: null,
  closedAt: null,
  closeReason: null,
  reopenedCount: 0,
  ...over,
})
const me = { id: agent.id, name: 'Priya' }

describe('support lifecycle', () => {
  it('goes New → Live on the first agent reply and records the first response time', () => {
    const r = onPublicMessage(state(), 'agent', now, { reopens: false, actorName: 'Priya' })
    expect(r.patch).toEqual({ status: 'live', firstRespondedAt: now })
    expect(r.events).toEqual([{ type: 'status', from: 'new', to: 'live' }])
  })

  it('stays New while only the customer writes', () => {
    expect(onPublicMessage(state(), 'customer', now, { reopens: false, actorName: 'Lab' }).patch).toEqual({})
  })

  it('reopens a closed conversation with a visible system line', () => {
    const r = onPublicMessage(state({ status: 'closed', closedAt: daysAgo(2), closeReason: 'resolved' }), 'customer', now, {
      reopens: true,
      actorName: 'Smile Lab',
    })
    expect(r.patch).toMatchObject({ status: 'live', closedAt: null, closeReason: null, reopenedCount: 1 })
    expect(r.systemMessages).toEqual(['Conversation reopened by Smile Lab'])
  })

  it('assigning a New conversation makes it Live', () => {
    const r = onAction(state(), { action: 'claim' }, me, now)
    expect(r.ok && r.result.patch).toEqual({ assigneeId: agent.id, status: 'live' })
    expect(r.ok && r.result.systemMessages).toEqual(['Priya is now handling this conversation'])
  })

  it('closes with a reason and refuses invalid moves', () => {
    const closed = onAction(state({ status: 'live' }), { action: 'close', reason: 'duplicate' }, me, now)
    expect(closed.ok && closed.result.patch).toMatchObject({ status: 'closed', closeReason: 'duplicate', closedBy: agent.id })
    expect(onAction(state({ status: 'closed', closedAt: now, closeReason: 'resolved' }), { action: 'close' }, me, now)).toEqual({
      ok: false,
      code: 'invalid_state',
    })
    expect(onAction(state({ status: 'live' }), { action: 'reopen' }, me, now)).toEqual({ ok: false, code: 'invalid_state' })
    expect(onAction(state({ priority: 'high' }), { action: 'set_priority', priority: 'high' }, me, now)).toEqual({ ok: false, code: 'no_change' })
  })

  it('records triage changes in the audit trail without announcing them in the thread', () => {
    const r = onAction(state(), { action: 'set_priority', priority: 'urgent' }, me, now)
    expect(r.ok && r.result.events).toEqual([{ type: 'priority', from: 'Normal', to: 'Urgent' }])
    expect(r.ok && r.result.systemMessages).toEqual([])
  })
})

describe('support validation', () => {
  it('trims and bounds messages', () => {
    expect(postMessageSchema.safeParse({ body: '   ', clientMsgId: crypto.randomUUID() }).success).toBe(false)
    expect(postMessageSchema.safeParse({ body: 'x'.repeat(10_001), clientMsgId: crypto.randomUUID() }).success).toBe(false)
    const ok = postMessageSchema.parse({ body: '  hello  ', clientMsgId: crypto.randomUUID() })
    expect(ok).toMatchObject({ body: 'hello', visibility: 'public' })
  })

  it('rejects unknown categories and malformed actions', () => {
    expect(createTicketSchema.safeParse({ subject: 'Help', category: 'nope', message: 'x' }).success).toBe(false)
    expect(actionSchema.safeParse({ action: 'assign' }).success).toBe(false)
    expect(actionSchema.safeParse({ action: 'assign', assigneeId: null }).success).toBe(true)
    expect(actionSchema.safeParse({ action: 'delete_everything' }).success).toBe(false)
  })

  it('formats ticket numbers', () => {
    expect(formatTicketNumber(42)).toBe('SUP-000042')
  })
})
