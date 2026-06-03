import { pgTable, uuid, timestamp, index, varchar } from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const supportCallbackRequests = pgTable('support_callback_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => profiles.id).notNull(),
  clientName: varchar('client_name', { length: 100 }).notNull(),
  labName: varchar('lab_name', { length: 150 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }).notNull(),
  createdBy: uuid('created_by').references(() => profiles.id),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
}, (table) => {
  return {
    clientIdx: index('support_callback_requests_client_id_idx').on(table.clientId),
    requestedAtIdx: index('support_callback_requests_requested_at_idx').on(table.requestedAt),
  }
})

export type SupportCallbackRequest = typeof supportCallbackRequests.$inferSelect
export type NewSupportCallbackRequest = typeof supportCallbackRequests.$inferInsert
