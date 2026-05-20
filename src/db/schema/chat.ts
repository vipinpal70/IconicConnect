import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
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
});
