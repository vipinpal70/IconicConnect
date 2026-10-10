import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  text,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core'
import { profiles } from './profile'

export const unitTypeEnum = pgEnum('unit_type', ['per_tooth', 'per_arch', 'per_case'])

export const serviceCatalog = pgTable(
  'service_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: varchar('category', { length: 100 }).notNull(),
    subCategory: varchar('sub_category', { length: 100 }).notNull(),
    unitType: unitTypeEnum('unit_type').notNull(),
    defaultPrice: numeric('default_price', { precision: 12, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ uq: unique('service_catalog_cat_sub_uq').on(table.category, table.subCategory) })
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
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    notes: text('notes'),
    // Client-level override of serviceCatalog.isActive — a service is
    // available to a client only if both are true. System isActive=false
    // always wins over isEnabled=true.
    isEnabled: boolean('is_enabled').default(true).notNull(),
    createdBy: uuid('created_by').references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ uq: unique('client_price_list_uq').on(table.clientId, table.catalogItemId) })
)

export type ServiceCatalogItem = typeof serviceCatalog.$inferSelect
export type NewServiceCatalogItem = typeof serviceCatalog.$inferInsert
export type ClientPriceListEntry = typeof clientPriceList.$inferSelect
export type NewClientPriceListEntry = typeof clientPriceList.$inferInsert
