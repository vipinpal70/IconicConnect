import { describe, expect, it } from 'vitest'
import { DEFAULT_SLA_POLICIES, SLA_STOPPED, formatDuration, nextSlaClock, slaDeadlines, slaState, type SlaColumns } from '@/src/lib/support/sla'
import { AUTO_CLOSE_WARNING, onAutoClose, shouldAutoClose, shouldWarnAutoClose, type LifecycleState } from '@/src/lib/support/lifecycle'
import { canRate } from '@/src/lib/support/policy'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const t0 = new Date('2026-11-20T10:00:00Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
const normal = DEFAULT_SLA_POLICIES.normal

describe('reply deadlines', () => {
  it('uses the first-response target until support has replied, then the next-response one', () => {
    expect(slaDeadlines(t0, normal, false)).toEqual({ dueAt: at(8 * HOUR), warnAt: at(6.4 * HOUR) })
    expect(slaDeadlines(t0, normal, true)).toEqual({ dueAt: at(24 * HOUR), warnAt: at(19.2 * HOUR) })
    expect(slaDeadlines(t0, DEFAULT_SLA_POLICIES.urgent, false).dueAt).toEqual(at(HOUR))
  })

  it('reports on track, due soon (80 %) and overdue', () => {
    const { dueAt, warnAt } = slaDeadlines(t0, normal, false)
    expect(slaState(dueAt, warnAt, at(HOUR))).toBe('on_track')
    expect(slaState(dueAt, warnAt, at(7 * HOUR))).toBe('due_soon')
    expect(slaState(dueAt, warnAt, at(8 * HOUR))).toBe('overdue')
    expect(slaState(null, null, t0)).toBeNull()
  })

  it('formats durations compactly', () => {
    expect(formatDuration(30_000)).toBe('1m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(-130 * 60_000)).toBe('2h 10m')
    expect(formatDuration(13 * HOUR)).toBe('13h')
    expect(formatDuration(3 * DAY)).toBe('3d')
  })
})

describe('reply clock', () => {
  const running = (startedAt: Date, level: 0 | 1 | 2 = 0, firstResponded = false): SlaColumns => {
    const { dueAt, warnAt } = slaDeadlines(startedAt, normal, firstResponded)
    return { slaStartedAt: startedAt, replyDueAt: dueAt, replyWarnAt: warnAt, slaAlertLevel: level }
  }
  const input = (over: Partial<Parameters<typeof nextSlaClock>[0]>) => ({
    status: 'live' as const,
    priority: 'normal' as const,
    lastPublicSender: 'customer' as const,
    firstResponded: true,
    current: SLA_STOPPED,
    ...over,
  })

  it('starts when the lab is newly waiting', () => {
    const clock = nextSlaClock(input({}), normal, t0)
    expect(clock).toEqual(running(t0, 0, true))
  })

  it('keeps running on a second lab message (no extra time, alerts kept)', () => {
    const current = running(t0, 1, true)
    expect(nextSlaClock(input({ current }), normal, at(3 * HOUR))).toEqual(current)
  })

  it('stops on a support reply and on close; notes never reach here', () => {
    const current = running(t0, 2, true)
    expect(nextSlaClock(input({ current, lastPublicSender: 'agent' }), normal, at(HOUR))).toEqual(SLA_STOPPED)
    expect(nextSlaClock(input({ current, status: 'closed' }), normal, at(HOUR))).toEqual(SLA_STOPPED)
  })

  it('moves the deadline and re-arms alerts when the priority changes', () => {
    const current = running(t0, 1, true)
    const urgent = nextSlaClock(input({ current, priority: 'urgent' }), DEFAULT_SLA_POLICIES.urgent, at(HOUR))
    expect(urgent).toMatchObject({ slaStartedAt: t0, replyDueAt: at(2 * HOUR), slaAlertLevel: 0 })
  })
})

describe('auto-close', () => {
  const waiting = { status: 'live' as const, lastPublicSender: 'agent' as const, lastAgentReplyAt: t0, autoCloseWarnedAt: null }

  it('warns after 6 days waiting on the lab, only once, only when waiting on the lab', () => {
    expect(shouldWarnAutoClose(waiting, at(6 * DAY - HOUR))).toBe(false)
    expect(shouldWarnAutoClose(waiting, at(6 * DAY))).toBe(true)
    expect(shouldWarnAutoClose({ ...waiting, autoCloseWarnedAt: at(6 * DAY) }, at(6 * DAY + HOUR))).toBe(false)
    expect(shouldWarnAutoClose({ ...waiting, lastPublicSender: 'customer' }, at(30 * DAY))).toBe(false)
    expect(shouldWarnAutoClose({ ...waiting, status: 'new' }, at(30 * DAY))).toBe(false)
    expect(AUTO_CLOSE_WARNING).toMatch(/tomorrow/)
  })

  it('closes a day after the warning unless the lab replied', () => {
    const warned = { status: 'live' as const, lastPublicSender: 'agent' as const, autoCloseWarnedAt: t0 }
    expect(shouldAutoClose(warned, at(DAY - 1))).toBe(false)
    expect(shouldAutoClose(warned, at(DAY))).toBe(true)
    expect(shouldAutoClose({ ...warned, lastPublicSender: 'customer' }, at(2 * DAY))).toBe(false)
    expect(shouldAutoClose({ ...warned, autoCloseWarnedAt: null }, at(2 * DAY))).toBe(false)
  })

  it('closes as "No reply" with no person attached and tells the lab how to reopen', () => {
    const state: LifecycleState = {
      status: 'live', assigneeId: null, priority: 'normal', category: 'technical',
      firstRespondedAt: t0, closedAt: null, closeReason: null, reopenedCount: 0,
    }
    const result = onAutoClose(state, at(7 * DAY))
    expect(result.patch).toEqual({ status: 'closed', closedAt: at(7 * DAY), closedBy: null, closeReason: 'no_reply' })
    expect(result.events).toEqual([{ type: 'auto_closed', from: 'live', to: 'closed' }])
    expect(result.systemMessages[0]).toMatch(/reopen/)
  })
})

describe('ratings', () => {
  const lab = { id: 'u1', role: 'subuser', clientId: 'lab-1' }
  const closed = { clientId: 'lab-1', status: 'closed' as const, closedAt: t0, closeReason: 'resolved', csatScore: null }

  it('lets the lab rate once, within the reopen window, for resolved or no-reply closes', () => {
    expect(canRate(lab, closed, at(DAY))).toBe(true)
    expect(canRate(lab, { ...closed, closeReason: 'no_reply' }, at(DAY))).toBe(true)
    expect(canRate(lab, { ...closed, csatScore: 4 }, at(DAY))).toBe(false)
    expect(canRate(lab, { ...closed, closeReason: 'spam' }, at(DAY))).toBe(false)
    expect(canRate(lab, closed, at(15 * DAY))).toBe(false)
    expect(canRate(lab, { ...closed, status: 'live', closedAt: null }, at(DAY))).toBe(false)
  })

  it('never lets agents or another lab rate', () => {
    expect(canRate({ id: 'a', role: 'qc', clientId: null }, closed, at(DAY))).toBe(false)
    expect(canRate({ id: 'x', role: 'client', clientId: 'lab-2' }, closed, at(DAY))).toBe(false)
  })
})
