import { pgTable, uuid, varchar, text, timestamp, boolean, index, jsonb, uniqueIndex } from "drizzle-orm/pg-core"
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
    validTill: varchar("valid_till", { length: 20 }).notNull(),
    targetClients: jsonb("target_clients").$type<string[]>().notNull().default([]),
    targetLocations: jsonb("target_locations").$type<string[]>().notNull().default([]),
    sponsored: boolean("sponsored").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return {
      categoryIdx: index("offers_category_idx").on(table.category),
      createdAtIdx: index("offers_created_at_idx").on(table.createdAt),
      sponsoredIdx: index("offers_sponsored_idx").on(table.sponsored),
    }
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => {
    return {
      offerClientUniqueIdx: uniqueIndex("offer_claims_offer_client_idx").on(table.offerId, table.clientId),
      createdAtIdx: index("offer_claims_created_at_idx").on(table.createdAt),
    }
  }
)

export type OfferClaim = typeof offerClaims.$inferSelect
export type NewOfferClaim = typeof offerClaims.$inferInsert
