import { pgTable, uuid, varchar, integer, timestamp, text, index } from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const clientPriceListItems = pgTable(
  'client_price_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    serviceName: varchar('service_name', { length: 200 }).notNull(),
    subCategory: varchar('sub_category', {length:200}).notNull(),
    price: integer('price').notNull(),
    notes: text('notes'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdBy: uuid('created_by').references(() => profiles.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index('client_price_list_items_client_id_idx').on(table.clientId),
    clientSortIdx: index('client_price_list_items_client_sort_idx').on(table.clientId, table.sortOrder),
  })
)

export type ClientPriceListItem = typeof clientPriceListItems.$inferSelect
export type NewClientPriceListItem = typeof clientPriceListItems.$inferInsert
