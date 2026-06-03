import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  text,
  index,
  unique,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const unitTypeEnum = pgEnum('unit_type', ['per_tooth', 'per_arch'])

export const serviceCatalog = pgTable(
  'service_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: varchar('category', { length: 100 }).notNull(),
    subCategory: varchar('sub_category', { length: 100 }).notNull(),
    unitType: unitTypeEnum('unit_type').notNull(),
    defaultPrice: numeric('default_price', { precision: 10, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    categorySubCategoryUniq: unique('service_catalog_category_sub_category_uniq').on(
      table.category,
      table.subCategory
    ),
    categoryIdx: index('service_catalog_category_idx').on(table.category),
  })
)

export const clientPriceList = pgTable(
  'client_price_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    catalogItemId: uuid('catalog_item_id')
      .references(() => serviceCatalog.id, { onDelete: 'cascade' })
      .notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => profiles.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    clientCatalogUniq: unique('client_price_list_client_catalog_uniq').on(
      table.clientId,
      table.catalogItemId
    ),
    clientIdx: index('client_price_list_client_id_idx').on(table.clientId),
  })
)

export type ServiceCatalogItem = typeof serviceCatalog.$inferSelect
export type NewServiceCatalogItem = typeof serviceCatalog.$inferInsert
export type ClientPriceListEntry = typeof clientPriceList.$inferSelect
export type NewClientPriceListEntry = typeof clientPriceList.$inferInsert
