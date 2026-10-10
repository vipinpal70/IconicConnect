import {
  bigint,
  char,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { cases } from './case'
import { profiles, userRoleEnum } from './profile'

// Which side of the bulk-download feature a row belongs to — the two are independent:
//   client_output  — a lab downloaded its case outputs (design file + previews)
//   internal_files — Iconic staff downloaded the lab's uploaded files
export const bulkDownloadScopeEnum = pgEnum('bulk_scope', ['client_output', 'internal_files'])

// in_progress → completed | failed.  `reset` is an admin override that voids earlier completed rows.
export const bulkDownloadStatusEnum = pgEnum('bulk_status', ['in_progress', 'completed', 'failed', 'reset'])

/**
 * Source of truth for "has this case already been bulk-downloaded". `cases.client_output_downloaded_at` /
 * `cases.internal_files_downloaded_at` are a cache of the latest `completed` row, written in the same
 * transaction. See bulk-download-check-plan.md.
 */
export const caseBulkDownloads = pgTable('case_bulk_downloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  // The owning lab — copied from cases.client_id so lab-level queries need no join.
  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'restrict' }).notNull(),
  scope: bulkDownloadScopeEnum('scope').notNull(),
  status: bulkDownloadStatusEnum('status').default('in_progress').notNull(),
  downloadedBy: uuid('downloaded_by').references(() => profiles.id, { onDelete: 'set null' }),
  downloadedByRole: userRoleEnum('downloaded_by_role'),
  filesDelivered: integer('files_delivered').default(0).notNull(),
  bytesDelivered: bigint('bytes_delivered', { mode: 'number' }).default(0).notNull(),
  // SHA-256 of the included file set, and the per-file fingerprints it was built from. A later download
  // is "updated" when it contains a fingerprint the last completed one did not (new/replaced file).
  contentSignature: char('content_signature', { length: 64 }),
  fingerprints: jsonb('fingerprints').$type<string[]>(),
  include: jsonb('include').$type<Record<string, boolean> | null>(),
  failureReason: text('failure_reason'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  inFlightIdx: uniqueIndex('uq_bulk_in_flight')
    .on(table.caseId, table.scope)
    .where(sql`${table.status} = 'in_progress'`),
}))

export type CaseBulkDownload = typeof caseBulkDownloads.$inferSelect
export type NewCaseBulkDownload = typeof caseBulkDownloads.$inferInsert
