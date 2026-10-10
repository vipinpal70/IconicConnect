import { pgTable, uuid, varchar, timestamp, pgEnum, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { profiles } from './profile'

export const supportTicketTypeEnum = pgEnum('ticket_category', [
  'technical',
  'billing',
  'case_issue',
  'feature_request',
  'account_access',
  'other',
])

export const supportTicketPriorityEnum = pgEnum('ticket_priority', [
  'low',
  'medium',
  'high',
  'critical',
])

export const supportTicketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'awaiting_client',
  'resolved',
  'closed',
])

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketNumber: varchar('ticket_number', { length: 60 }).notNull().unique().default(sql`('TKT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('support_ticket_seq')::text, 6, '0'))`),
  clientId: uuid('client_id').references(() => profiles.id).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  message: text('message').notNull(),
  category: supportTicketTypeEnum('category').notNull(),
  priority: supportTicketPriorityEnum('priority').default('medium').notNull(),
  status: supportTicketStatusEnum('status').default('open').notNull(),
  adminNotes: text('admin_notes'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type SupportTicket = typeof supportTickets.$inferSelect
export type NewSupportTicket = typeof supportTickets.$inferInsert
