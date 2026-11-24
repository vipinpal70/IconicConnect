/**
 * When a case chat message may be edited or deleted. Pure and browser-safe: the server enforces these
 * rules in SQL (chat-modify.ts) and the UI uses them to decide which buttons to show.
 */

/** The sender can change a message for this long after sending it. */
export const CHAT_MODIFY_WINDOW_MS = 2 * 60_000
/** Extra time the server allows, so a click made in the last second isn't lost to network delay. */
export const CHAT_MODIFY_GRACE_MS = 5_000
/** Chat emails wait until a message can no longer change, then use its final text. */
export const CHAT_EMAIL_DELAY_MS = CHAT_MODIFY_WINDOW_MS + CHAT_MODIFY_GRACE_MS + 5_000
export const MAX_CHAT_EDIT_LENGTH = 10_000

/** Lines the case page posts when a lab requests changes or rejects: the record of a case action. */
export const CASE_ACTION_PREFIXES = ['[CHANGE REQUEST]:', '[CASE REJECTED]:'] as const

export const isCaseActionLine = (text: string) => CASE_ACTION_PREFIXES.some((p) => text.startsWith(p))

export interface ChatModifyInput {
  isSender: boolean
  deleted: boolean
  text: string
  hasAttachment: boolean
  /** The case was rejected by the lab: the whole chat is read-only. */
  chatLocked: boolean
  /** Milliseconds since the message was sent, by the database clock. */
  ageMs: number
}

/** What the viewer may do with a message, and for how much longer (0 = nothing). */
export function chatModifyState(m: ChatModifyInput): { canEdit: boolean; canDelete: boolean; msLeft: number } {
  const msLeft = Math.max(0, CHAT_MODIFY_WINDOW_MS - Math.max(0, m.ageMs))
  if (!m.isSender || m.deleted || m.chatLocked || isCaseActionLine(m.text) || msLeft === 0) {
    return { canEdit: false, canDelete: false, msLeft: 0 }
  }
  // An attachment message's text is only "Shared an attachment: name", so there is nothing to edit
  return { canEdit: !m.hasAttachment, canDelete: true, msLeft }
}

/** "1:42" */
export function formatTimeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
