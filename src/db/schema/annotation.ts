import { pgTable, uuid, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { profiles } from './profile'
import { cases } from './case'

/**
 * 3D Dental CAD / DICOM Annotation Document.
 * Source of truth for explicit-save 3D annotations, layers, measurements, and review pins.
 */
export const annotationDocuments = pgTable('annotation_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull().unique(),
  revision: integer('revision').default(1).notNull(),
  schemaVersion: integer('schema_version').default(1).notNull(),
  documentData: jsonb('document_data').notNull().default({}),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Historical audit log of confirmed annotation revisions.
 * Written atomically whenever a manual save is committed.
 */
export const annotationVersions = pgTable('annotation_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => annotationDocuments.id, { onDelete: 'cascade' }).notNull(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }).notNull(),
  revision: integer('revision').notNull(),
  documentData: jsonb('document_data').notNull(),
  savedBy: uuid('saved_by').references(() => profiles.id, { onDelete: 'set null' }),
  savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
})

export type AnnotationDocumentRow = typeof annotationDocuments.$inferSelect
export type NewAnnotationDocumentRow = typeof annotationDocuments.$inferInsert
export type AnnotationVersionRow = typeof annotationVersions.$inferSelect
export type NewAnnotationVersionRow = typeof annotationVersions.$inferInsert
