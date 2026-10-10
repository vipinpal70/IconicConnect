import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { notificationPreferences, notificationSettings } from '@/src/db/schema/notification'

/**
 * Preferences are sparse rows: (user, event) opt-outs + one settings row for the master switches.
 * A missing row means "enabled", so there is no seeding on sign-up and a new event type needs no migration.
 * `loadPreferences` rebuilds the flat object the rest of the code (and the UI) already uses —
 * { emailEnabled, inAppEnabled, caseAssignedEmail, caseAssignedInApp, ... } — all defaulting to true.
 */
export const PREFERENCE_EVENTS = {
  caseAssigned: 'case_assigned',
  caseFeedback: 'case_feedback',
  caseApproved: 'case_approved',
  caseRejected: 'case_rejected',
  caseHold: 'case_hold',
  caseCancel: 'case_cancel',
  caseReminder: 'case_reminder',
  chatMessage: 'chat_message',
  caseCreated: 'case_created',
  offerCreated: 'offer_created',
  tutorialCreated: 'tutorial_created',
  supportTicketCreated: 'support_ticket_created',
  supportTicketUpdated: 'support_ticket_updated',
  supportCallback: 'support_callback',
} as const

export type PreferenceView = { emailEnabled: boolean; inAppEnabled: boolean } & Record<string, boolean>

const EVENT_BY_TYPE = new Map<string, string>(Object.entries(PREFERENCE_EVENTS).map(([camel, ev]) => [ev, camel]))

export const PREFERENCE_KEYS: string[] = [
  'emailEnabled', 'inAppEnabled',
  ...Object.keys(PREFERENCE_EVENTS).flatMap((b) => [`${b}Email`, `${b}InApp`]),
]

function defaults(): PreferenceView {
  const v: PreferenceView = { emailEnabled: true, inAppEnabled: true }
  for (const b of Object.keys(PREFERENCE_EVENTS)) { v[`${b}Email`] = true; v[`${b}InApp`] = true }
  return v
}

/** One round trip for N users (two small PK-prefix reads). */
export async function loadPreferences(userIds: string[]): Promise<Map<string, PreferenceView>> {
  const out = new Map<string, PreferenceView>()
  if (!userIds.length) return out
  const [settings, rows] = await Promise.all([
    db.select().from(notificationSettings).where(inArray(notificationSettings.userId, userIds)),
    db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds)),
  ])
  for (const id of userIds) out.set(id, defaults())
  for (const s of settings) {
    const v = out.get(s.userId)!
    v.emailEnabled = s.emailEnabled
    v.inAppEnabled = s.inAppEnabled
  }
  for (const r of rows) {
    const base = EVENT_BY_TYPE.get(r.eventType)
    if (!base) continue
    const v = out.get(r.userId)!
    v[`${base}Email`] = r.emailEnabled
    v[`${base}InApp`] = r.inAppEnabled
  }
  return out
}

export async function loadPreference(userId: string): Promise<PreferenceView> {
  return (await loadPreferences([userId])).get(userId)!
}

/** Set one switch. Rows that return to the all-enabled default are deleted to keep the table sparse. */
export async function setPreference(userId: string, key: string, value: boolean): Promise<PreferenceView> {
  if (!PREFERENCE_KEYS.includes(key)) throw new Error(`Invalid preference key: ${key}`)

  if (key === 'emailEnabled' || key === 'inAppEnabled') {
    await db.insert(notificationSettings).values({ userId, [key]: value })
      .onConflictDoUpdate({ target: notificationSettings.userId, set: { [key]: value, updatedAt: new Date() } })
  } else {
    const isEmail = key.endsWith('Email')
    const camel = key.slice(0, -5) // both suffixes ("Email", "InApp") are 5 characters
    const eventType = PREFERENCE_EVENTS[camel as keyof typeof PREFERENCE_EVENTS]
    const col = isEmail ? 'emailEnabled' : 'inAppEnabled'
    await db.insert(notificationPreferences).values({ userId, eventType, [col]: value })
      .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.eventType], set: { [col]: value } })
    await db.delete(notificationPreferences).where(and(
      eq(notificationPreferences.userId, userId), eq(notificationPreferences.eventType, eventType),
      eq(notificationPreferences.emailEnabled, true), eq(notificationPreferences.inAppEnabled, true),
    ))
  }
  return loadPreference(userId)
}
