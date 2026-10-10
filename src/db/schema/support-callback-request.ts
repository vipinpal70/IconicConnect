import { pgTable, uuid, timestamp, varchar } from 'drizzle-orm/pg-core'
import { profiles, citext } from './profile'

export const supportCallbackRequests = pgTable('support_callback_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  // Contact details as given at request time. Client/lab name are joined from profiles, not copied.
  phone: varchar('phone', { length: 30 }),
  email: citext('email').notNull(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
})

export type SupportCallbackRequest = typeof supportCallbackRequests.$inferSelect
export type NewSupportCallbackRequest = typeof supportCallbackRequests.$inferInsert
