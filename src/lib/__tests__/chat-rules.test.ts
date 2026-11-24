import { describe, expect, it } from 'vitest'
import { CHAT_EMAIL_DELAY_MS, CHAT_MODIFY_GRACE_MS, CHAT_MODIFY_WINDOW_MS, chatModifyState, formatTimeLeft } from '@/src/lib/chat-rules'

const own = { isSender: true, deleted: false, text: 'hello', hasAttachment: false, chatLocked: false, ageMs: 18_000 }
const nothing = { canEdit: false, canDelete: false, msLeft: 0 }

describe('case chat: what the viewer may change', () => {
  it('lets the sender edit and delete for 2 minutes', () => {
    expect(chatModifyState(own)).toEqual({ canEdit: true, canDelete: true, msLeft: 102_000 })
    expect(chatModifyState({ ...own, ageMs: 119_999 })).toMatchObject({ canEdit: true, canDelete: true, msLeft: 1 })
    expect(chatModifyState({ ...own, ageMs: 120_000 })).toEqual(nothing)
  })

  it('never offers more than 2 minutes', () => {
    expect(chatModifyState({ ...own, ageMs: -5_000 }).msLeft).toBe(CHAT_MODIFY_WINDOW_MS)
  })

  it('allows deleting but not editing a message with an attachment', () => {
    expect(chatModifyState({ ...own, hasAttachment: true })).toMatchObject({ canEdit: false, canDelete: true })
  })

  it('offers nothing to others, on deleted messages, on a rejected case, or on case-action lines', () => {
    expect(chatModifyState({ ...own, isSender: false })).toEqual(nothing)
    expect(chatModifyState({ ...own, deleted: true })).toEqual(nothing)
    expect(chatModifyState({ ...own, chatLocked: true })).toEqual(nothing)
    expect(chatModifyState({ ...own, text: '[CHANGE REQUEST]: thinner margins' })).toEqual(nothing)
    expect(chatModifyState({ ...own, text: '[CASE REJECTED]: wrong tooth' })).toEqual(nothing)
    expect(chatModifyState({ ...own, text: 'about the [CHANGE REQUEST]: ok' })).toMatchObject({ canEdit: true })
  })

  it('emails only after the last moment a message can change', () => {
    expect(CHAT_EMAIL_DELAY_MS).toBeGreaterThan(CHAT_MODIFY_WINDOW_MS + CHAT_MODIFY_GRACE_MS)
  })

  it('formats the countdown', () => {
    expect(formatTimeLeft(102_000)).toBe('1:42')
    expect(formatTimeLeft(5_200)).toBe('0:06')
    expect(formatTimeLeft(0)).toBe('0:00')
  })
})
