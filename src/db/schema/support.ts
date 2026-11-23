import { sql } from 'drizzle-orm'
import { pgTable, pgEnum, uuid, varchar, text, bigint, integer, smallint, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { profiles } from './profile'
import { cases } from './case'
import { files } from './files'

/**
 * Support system (see support-system.md). Tables are created by
 * db/migrations/20261122000100_support_system.sql; this file only types them for Drizzle.
 */

export const supStatusEnum = pgEnum('sup_status', ['new', 'live', 'closed'])
export const supPriorityEnum = pgEnum('sup_priority', ['low', 'normal', 'high', 'urgent'])
export const supCategoryEnum = pgEnum('sup_category', ['technical', 'billing', 'case', 'account', 'feature_request', 'callback', 'other'])
export const supSourceEnum = pgEnum('sup_source', ['page', 'widget', 'agent', 'import'])
export const supMessageKindEnum = pgEnum('sup_message_kind', ['customer', 'agent', 'note', 'system'])
export const supSideEnum = pgEnum('sup_side', ['customer', 'agent'])
export const supCloseReasonEnum = pgEnum('sup_close_reason', ['resolved', 'no_reply', 'duplicate', 'spam'])
export const supEventTypeEnum = pgEnum('sup_event_type', ['created', 'status', 'assignee', 'priority', 'category', 'reopened', 'linked', 'rated', 'auto_closed'])

const tstz = (name: string) => timestamp(name, { withTimezone: true })

export const supTickets = pgTable('sup_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: bigint('number', { mode: 'number' }).notNull().default(sql`nextval('sup_ticket_number_seq')`),
  legacyNumber: varchar('legacy_number', { length: 60 }),
  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  subject: varchar('subject', { length: 200 }).notNull(),
  category: supCategoryEnum('category').notNull(),
  priority: supPriorityEnum('priority').default('normal').notNull(),
  status: supStatusEnum('status').default('new').notNull(),
  assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
  source: supSourceEnum('source').default('page').notNull(),
  relatedCaseId: uuid('related_case_id').references(() => cases.id, { onDelete: 'set null' }),
  linkedTicketId: uuid('linked_ticket_id'),
  lastMessageAt: tstz('last_message_at').defaultNow().notNull(),
  lastMessageSeq: bigint('last_message_seq', { mode: 'number' }).default(0).notNull(),
  lastPublicSender: supSideEnum('last_public_sender'),
  firstResponseDueAt: tstz('first_response_due_at'),
  firstRespondedAt: tstz('first_responded_at'),
  closedAt: tstz('closed_at'),
  closedBy: uuid('closed_by').references(() => profiles.id, { onDelete: 'set null' }),
  closeReason: supCloseReasonEnum('close_reason'),
  reopenedCount: integer('reopened_count').default(0).notNull(),
  csatScore: smallint('csat_score'),
  csatComment: text('csat_comment'),
  csatAt: tstz('csat_at'),
  createdAt: tstz('created_at').defaultNow().notNull(),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
})

export const supMessages = pgTable('sup_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => supTickets.id, { onDelete: 'cascade' }).notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull().default(sql`nextval('sup_message_seq')`),
  kind: supMessageKindEnum('kind').notNull(),
  authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  clientMsgId: uuid('client_msg_id'),
  createdAt: tstz('created_at').defaultNow().notNull(),
  editedAt: tstz('edited_at'),
  deletedAt: tstz('deleted_at'),
})

export const supReads = pgTable('sup_reads', {
  ticketId: uuid('ticket_id').references(() => supTickets.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  lastReadSeq: bigint('last_read_seq', { mode: 'number' }).default(0).notNull(),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.ticketId, t.userId] }) }))

export const supEvents = pgTable('sup_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => supTickets.id, { onDelete: 'cascade' }).notNull(),
  actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
  type: supEventTypeEnum('type').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  createdAt: tstz('created_at').defaultNow().notNull(),
})

export const supAttachmentKindEnum = pgEnum('sup_attachment_kind', ['image', 'video', 'document'])

/** Links an uploaded file (in `files`) to a support message. Created at upload time, bound on send. */
export const supAttachments = pgTable('sup_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  ticketId: uuid('ticket_id').references(() => supTickets.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => supMessages.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
  kind: supAttachmentKindEnum('kind').notNull(),
  createdAt: tstz('created_at').defaultNow().notNull(),
})

export type SupTicketRow = typeof supTickets.$inferSelect
export type SupMessageRow = typeof supMessages.$inferSelect
