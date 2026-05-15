import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  text,
} from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const caseStatusEnum = pgEnum('case_status', [
  'pending',
  'submitted',
  'in_design',
  'in_qc',
  'approved',
  'on_hold',
  'rejected',
  'completed',
  'shipped',
])

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Ownership
  clientId: uuid('client_id').references(() => profiles.id).notNull(),
  subuserId: uuid('subuser_id').references(() => profiles.id),
  
  // Patient Info
  patientName: varchar('patient_name', { length: 255 }).notNull(),
  caseNumber: varchar('case_number', { length: 50 }).unique(),
  
  // Status
  status: caseStatusEnum('status').default('pending').notNull(),
  
  // Assignments (Operational Roles)
  designerId: uuid('designer_id').references(() => profiles.id),
  qcId: uuid('qc_id').references(() => profiles.id),
  accountManagerId: uuid('account_manager_id').references(() => profiles.id),
  
  // Dates
  dueDate: timestamp('due_date'),
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

export type Case = typeof cases.$inferSelect
export type NewCase = typeof cases.$inferInsert
export type CaseMessage = typeof caseMessages.$inferSelect
export type NewCaseMessage = typeof caseMessages.$inferInsert
