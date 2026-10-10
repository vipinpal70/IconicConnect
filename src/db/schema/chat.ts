import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { cases } from './case'
import { profiles, userRoleEnum } from './profile'

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'restrict' }).notNull(),
  senderRole: userRoleEnum('sender_role').notNull(), // snapshot at send time; name is joined from profiles
  messageText: text('message_text').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const chatReadStates = pgTable('chat_read_states', {
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.caseId, t.userId] }) }))
