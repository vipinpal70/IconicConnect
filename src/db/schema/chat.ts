import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { cases } from './case';
import { profiles } from './profile';

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => profiles.id).notNull(),
  senderRole: text('sender_role').notNull(), // 'client' | 'subuser' | 'admin' | 'qc' | 'designer'
  senderName: text('sender_name').notNull(),
  messageText: text('message_text').notNull(),
  fileUrl: text('file_url'),
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileSize: text('file_size'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  caseIdx: index('chat_messages_case_id_idx').on(table.caseId),
  caseCreatedAtIdx: index('chat_messages_case_created_at_idx').on(table.caseId, table.createdAt),
}));

export const chatReadStates = pgTable('chat_read_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  caseUserIdx: uniqueIndex('chat_read_states_case_user_idx').on(table.caseId, table.userId),
  userIdx: index('chat_read_states_user_idx').on(table.userId),
}));
