import { pgTable, uuid, varchar, text, timestamp, bigint, char, pgEnum } from 'drizzle-orm/pg-core'
import { profiles } from './profile'
import { cases } from './case'
import { chatMessages } from './chat'

export const fileKindEnum = pgEnum('file_kind', ['scan', 'preview', 'reference', 'hold', 'output', 'teeth_library', 'chat'])
export const fileStatusEnum = pgEnum('file_status', ['pending', 'ready', 'failed', 'purged'])
export type FileKind = (typeof fileKindEnum.enumValues)[number]

/**
 * One row per R2 object. Replaces case_files / case_preview_files / case_reference_files / case_hold_files,
 * cases.output_file / preview_file / teeth_library_file_* and chat attachment columns.
 * ALWAYS filter by `kind` so previews/reference/hold images never leak into the "Case Files" list.
 * r2_key keeps the existing `${labName}/${fileName}` scheme so current objects and links keep working.
 */
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'restrict' }).notNull(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }),
  kind: fileKindEnum('kind').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  r2Key: text('r2_key').notNull(), // NOT unique: one object can back several logical files (see migration 1700)
  contentType: varchar('content_type', { length: 150 }),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: char('sha256', { length: 64 }),
  note: text('note'),
  status: fileStatusEnum('status').default('pending').notNull(),
  uploadId: text('upload_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type FileRow = typeof files.$inferSelect
export type NewFileRow = typeof files.$inferInsert
