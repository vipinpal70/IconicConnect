import { pgTable, uuid, varchar, text, timestamp, boolean, date, uniqueIndex } from "drizzle-orm/pg-core"
import { profiles } from "./profile"

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    brand: varchar("brand", { length: 120 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    description: text("description").notNull(),
    discount: varchar("discount", { length: 120 }).notNull(),
    startDate: date("start_date"),
    validTill: date("valid_till").notNull(),
    targetClients: uuid("target_client_ids").array().notNull().default([]),
    targetLocations: text("target_locations").array().notNull().default([]),
    sponsored: boolean("sponsored").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
)

export type Offer = typeof offers.$inferSelect
export type NewOffer = typeof offers.$inferInsert

export const offerClaims = pgTable(
  "offer_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 50 }).default("claimed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return {
      offerClientUniqueIdx: uniqueIndex("offer_claims_uq").on(table.offerId, table.clientId),
    }
  }
)

export type OfferClaim = typeof offerClaims.$inferSelect
export type NewOfferClaim = typeof offerClaims.$inferInsert
