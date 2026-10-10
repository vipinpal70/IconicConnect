import { boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { cases } from './case'
import { profiles, userRoleEnum, userTypeEnum } from './profile'

/** Single audit + case-timeline table (replaces cases.timeline jsonb). */
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
  // Snapshots: survive role changes and account deletion.
  userType: userTypeEnum('actor_type'),
  userRole: userRoleEnum('actor_role'),
  actorName: text('actor_name'),
  action: varchar('action', { length: 120 }).notNull(),
  label: text('label'),               // staff-facing text, frozen at write time
  clientLabel: text('client_label'),  // lab-facing wording (null => use label)
  clientVisible: boolean('client_visible').default(false).notNull(),
  details: jsonb('details').$type<Record<string, unknown> | null>(),
  actionAt: timestamp('action_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ActivityLog = typeof activityLogs.$inferSelect
export type NewActivityLog = typeof activityLogs.$inferInsert
