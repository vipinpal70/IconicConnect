import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { cases } from './case'
import { profiles, userRoleEnum, userTypeEnum } from './profile'

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').references(() => cases.id),
    userId: uuid('user_id').references(() => profiles.id).notNull(),
    userType: userTypeEnum('user_type').notNull(),
    userRole: userRoleEnum('user_role').notNull(),
    action: varchar('action', { length: 120 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown> | null>(),
    actionAt: timestamp('action_at').defaultNow().notNull(),
  },
  (table) => ({
    caseIdx: index('activity_logs_case_idx').on(table.caseId),
    userIdx: index('activity_logs_user_idx').on(table.userId),
    actionAtIdx: index('activity_logs_action_at_idx').on(table.actionAt),
  })
)

export type ActivityLog = typeof activityLogs.$inferSelect
export type NewActivityLog = typeof activityLogs.$inferInsert
