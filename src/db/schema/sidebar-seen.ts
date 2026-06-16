import { pgTable, uuid, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const sidebarSeenAt = pgTable(
  'sidebar_seen_at',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    pageKey: varchar('page_key', { length: 50 }).notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => ({
    userPageIdx: uniqueIndex('sidebar_seen_user_page_idx').on(table.userId, table.pageKey),
    userIdx: index('sidebar_seen_user_idx').on(table.userId),
  })
)

export type SidebarSeenAt = typeof sidebarSeenAt.$inferSelect
export type NewSidebarSeenAt = typeof sidebarSeenAt.$inferInsert
