import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  text,
  integer,
  jsonb,
  boolean,
  smallint,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { profiles, userRoleEnum } from './profile'

export const caseStatusEnum = pgEnum('case_status', [
  'scan_received',           // 1. Scan received
  'allocated_to_designer',   // 2. Allocated to designer
  'scan_verified',           // 3. Scan verified
  'scan_not_verified',       // 4. Scan not verified
  'in_progress',             // 5. In progress (work started)
  'internal_qc',             // 6. Internal QC
  'submitted_to_client',     // 7. Submitted to the client
  'on_hold',                 // 8. Hold / failed
  'client_feedback',         // 9. Client feedback / rejected
  'approved',                // 10. Approved
  'delivered',               // 11. Delivered
  'cancelled',               // 12. Cancelled
  'change_requested',        // 13. Change requested
  'client_reject',           // 14. Client rejected case
])

export const CASE_LIFECYCLE_STEPS = [
  'Submitted',
  'In Validation',
  'In Design',
  'Internal QC',
  'Pending Client Approval',
  'Completed',
] as const

export const CASE_STATUS_TO_LIFECYCLE_STEP: Record<
  typeof caseStatusEnum.enumValues[number],
  (typeof CASE_LIFECYCLE_STEPS)[number]
> = {
  scan_received: 'Submitted',
  scan_not_verified: 'In Validation',
  scan_verified: 'In Validation',
  allocated_to_designer: 'Submitted',
  in_progress: 'In Design',
  internal_qc: 'Internal QC',
  submitted_to_client: 'Pending Client Approval',
  client_feedback: 'In Design',
  on_hold: 'In Validation',
  approved: 'Completed',
  delivered: 'Completed',
  cancelled: 'Completed',
  change_requested: 'Pending Client Approval',
  client_reject: 'Completed',
}

export const CLIENT_STATUS_LABELS: Record<typeof caseStatusEnum.enumValues[number], string> = {
  scan_received: 'Case Submitted',
  scan_not_verified: 'In Validation',
  scan_verified: 'Validated',
  allocated_to_designer: 'In Design',
  in_progress: 'In Design',
  internal_qc: 'Internal QC',
  submitted_to_client: 'Client Review',
  client_feedback: 'Feedback',
  on_hold: 'On Hold',
  approved: 'Case Approved',
  delivered: 'Completed',
  cancelled: 'Cancelled',
  change_requested: 'Change Requested',
  client_reject: 'Rejected',
}

export const INTERNAL_STATUS_LABELS: Record<typeof caseStatusEnum.enumValues[number], string> = {
  scan_received: 'Scan Received',
  scan_not_verified: 'Scan Rejected',
  scan_verified: 'Scan Verified',
  allocated_to_designer: 'Allocated (Designer)',
  in_progress: 'In Progress',
  internal_qc: 'Internal QC',
  submitted_to_client: 'Submitted to Client',
  client_feedback: 'Client Feedback',
  on_hold: 'On Hold',
  approved: 'Approved',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  change_requested: 'Change Requested',
  client_reject: 'Rejected',
}

/**
 * Cases are editable (by client/subuser) only BEFORE work starts.
 * Once a case reaches 'in_progress' or beyond, only admins can modify it.
 */
export const EDITABLE_STATUSES: Array<typeof caseStatusEnum.enumValues[number]> = [
  'scan_received',
  'allocated_to_designer',
  'scan_verified',
  'scan_not_verified',
]

export type CaseTimelineEvent = {
  id: string
  action: string
  label: string
  actor: string
  actionAt: string
  actionTime?: string
  clientLabel?: string
  clientHidden?: boolean
}

const tstz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Hot, narrow row: only what list screens read. Cold fields live in `case_details`, history in
 * `activity_logs` (the old `timeline` jsonb), files in `files`.
 * Property names that were merely renamed in SQL (startTime, deliveredTime, tat) keep their old TS names.
 */
export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseNumber: varchar('case_number', { length: 50 }).notNull().unique(),

  clientId: uuid('client_id').references(() => profiles.id, { onDelete: 'restrict' }).notNull(),
  subuserId: uuid('subuser_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdById: uuid('created_by_id').references(() => profiles.id, { onDelete: 'set null' }),

  category: varchar('category', { length: 100 }).notNull(),
  caseType: varchar('case_type', { length: 100 }), // trigger-maintained from sub_type_data
  subTypeData: jsonb('sub_type_data').$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),
  teeth: smallint('teeth').array().default(sql`'{}'`).notNull(),
  teethCount: integer('teeth_count'), // GENERATED ALWAYS — read-only

  status: caseStatusEnum('status').default('scan_received').notNull(),
  holdReason: text('hold_reason'),
  cancelReason: text('cancel_reason'),
  feedbackReason: text('feedback_reason'),
  rejectReason: text('reject_reason'),

  designerId: uuid('designer_id').references(() => profiles.id, { onDelete: 'set null' }),
  qcId: uuid('qc_id').references(() => profiles.id, { onDelete: 'set null' }),
  accountManagerId: uuid('account_manager_id').references(() => profiles.id, { onDelete: 'set null' }),

  autoApproved: boolean('auto_approved').default(false).notNull(),
  submittedToClientAt: tstz('submitted_to_client_at'),
  startTime: tstz('started_at'),
  deliveredTime: tstz('completed_at'),
  tat: integer('tat_minutes'), // minutes (completed - started)
  dueDate: tstz('due_date'),

  // Bulk-download cache (source of truth: case_bulk_downloads). internal_* is staff-only.
  clientOutputDownloadedAt: tstz('client_output_downloaded_at'),
  internalFilesDownloadedAt: tstz('internal_files_downloaded_at'),
  preferredTeethLibrary: varchar('preferred_teeth_library', { length: 50 }).default('default').notNull(),

  searchText: text('search_text').default('').notNull(), // trigger-maintained — never write
  rowVersion: integer('row_version').default(1).notNull(), // trigger-bumped

  createdAt: tstz('created_at').defaultNow().notNull(),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
})

/** Cold / large fields, fetched only by the case-detail endpoint. */
export const caseDetails = pgTable('case_details', {
  caseId: uuid('case_id').primaryKey().references(() => cases.id, { onDelete: 'cascade' }),
  approvalChecklist: jsonb('approval_checklist').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  outputNote: text('output_note'),
  clientMessage: text('client_message'),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
})

/** Static status metadata + flow flags (see migration 0300/1600). */
export const caseStatusMeta = pgTable('case_status_meta', {
  status: caseStatusEnum('status').primaryKey(),
  adminLabel: text('admin_label').notNull(),
  clientLabel: text('client_label').notNull(),
  lifecycleStep: text('lifecycle_step').notNull(),
  stepOrder: smallint('step_order').notNull(),
  isFinished: boolean('is_finished').notNull(),
  isBillable: boolean('is_billable').default(false).notNull(),
})

export const caseStatusTransitions = pgTable('case_status_transitions', {
  role: userRoleEnum('role').notNull(),
  fromStatus: caseStatusEnum('from_status').notNull(),
  toStatus: caseStatusEnum('to_status').notNull(),
  needsAssignment: boolean('needs_assignment').default(false).notNull(),
  needsOutputFile: boolean('needs_output_file').default(false).notNull(),
  needsQcLead: boolean('needs_qc_lead').default(false).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.role, t.fromStatus, t.toStatus] }) }))

export type Case = typeof cases.$inferSelect
export type NewCase = typeof cases.$inferInsert
export type CaseDetails = typeof caseDetails.$inferSelect
