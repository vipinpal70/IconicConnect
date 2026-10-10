import { pgTable, uuid, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const sidebarSeenAt = pgTable(
  'sidebar_seen_at',
  {
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
    pageKey: varchar('page_key', { length: 50 }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.userId, table.pageKey] }) })
)

export type SidebarSeenAt = typeof sidebarSeenAt.$inferSelect
export type NewSidebarSeenAt = typeof sidebarSeenAt.$inferInsert
