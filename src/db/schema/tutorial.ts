import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core"
import { profiles } from "./profile"

export const tutorials = pgTable("tutorials", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 40 }).notNull().default("Getting Started"),
  description: text("description").notNull(),
  youtubeVideoId: varchar("youtube_video_id", { length: 32 }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export type Tutorial = typeof tutorials.$inferSelect
export type NewTutorial = typeof tutorials.$inferInsert
