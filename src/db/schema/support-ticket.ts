import { pgTable, uuid, varchar, timestamp, pgEnum, text, index } from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const supportTicketTypeEnum = pgEnum('support_ticket_type', [
  'technical',
  'billing',
  'case_issue',
  'feature_request',
  'account_access',
  'other',
])

export const supportTicketPriorityEnum = pgEnum('support_ticket_priority', [
  'low',
  'medium',
  'high',
  'critical',
])

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'awaiting_client',
  'resolved',
  'closed',
])

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketNumber: varchar('ticket_number', { length: 60 }).notNull().unique(),
  clientId: uuid('client_id').references(() => profiles.id).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  message: text('message').notNull(),
  category: supportTicketTypeEnum('category').notNull(),
  priority: supportTicketPriorityEnum('priority').default('medium').notNull(),
  status: supportTicketStatusEnum('status').default('open').notNull(),
  adminNotes: text('admin_notes'),
  resolvedAt: timestamp('resolved_at'),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    clientIdx: index('support_tickets_client_id_idx').on(table.clientId),
    statusIdx: index('support_tickets_status_idx').on(table.status),
    createdAtIdx: index('support_tickets_created_at_idx').on(table.createdAt),
  }
})

export type SupportTicket = typeof supportTickets.$inferSelect
export type NewSupportTicket = typeof supportTickets.$inferInsert
