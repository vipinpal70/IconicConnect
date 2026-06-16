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
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { profiles } from './profile'

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
}

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Ownership
  clientId: uuid('client_id').references(() => profiles.id).notNull(),
  subuserId: uuid('subuser_id').references(() => profiles.id),
  createdBy: varchar('created_by', { length: 255 }),

  caseNumber: varchar('case_number', { length: 50 }).unique(),

  // Dynamic Type
  category: varchar('category', { length: 100 }),
  subTypeData: jsonb('sub_type_data'),

  // Status
  status: caseStatusEnum('status').default('scan_received').notNull(),
  holdReason: text('hold_reason'),
  cancelReason: text('cancel_reason'),
  feedbackReason: text('feedback_reason'),
  rejectReason: text('reject_reason'),
  clientMassage: text('client_massage'),
  approvalChecklist: jsonb('approval_checklist').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),

  // Assignments (Operational Roles)
  designerId: uuid('designer_id').references(() => profiles.id),
  qcId: uuid('qc_id').references(() => profiles.id),
  accountManagerId: uuid('account_manager_id').references(() => profiles.id),

  // Dates
  autoApproved: boolean('auto_approved').default(false).notNull(),
  submittedToClientAt: timestamp('submitted_to_client_at'),

  startTime: timestamp('start_time'),
  deliveredTime: timestamp('delivered_time'),
  dueDate: timestamp('due_date'),
  timeline: jsonb('timeline').$type<CaseTimelineEvent[]>().default(sql`'[]'::jsonb`).notNull(),
  outputFile: text('output_file'),
  previewFile: text('preview_file'),
  outputNote: text('output_note'),
  preferredTeethLibrary: varchar('preferred_teeth_library', { length: 50 }).default('default').notNull(),
  teethLibraryFileUrl: text('teeth_library_file_url'),
  teethLibraryFileName: varchar('teeth_library_file_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const caseMessages = pgTable('case_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  senderId: uuid('sender_id').references(() => profiles.id).notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const caseFiles = pgTable('case_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  note: text('note'),
  fileType: varchar('file_type', { length: 100 }),
  fileSize: integer('file_size'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Case = typeof cases.$inferSelect
export type NewCase = typeof cases.$inferInsert
export type CaseMessage = typeof caseMessages.$inferSelect
export type NewCaseMessage = typeof caseMessages.$inferInsert
export type CaseFile = typeof caseFiles.$inferSelect
export type NewCaseFile = typeof caseFiles.$inferInsert
