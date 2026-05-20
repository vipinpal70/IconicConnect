import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core"

export const tutorials = pgTable("tutorials", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 40 }).notNull().default("Getting Started"),
  description: text("description").notNull(),
  youtubeVideoId: varchar("youtube_video_id", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    createdAtIdx: index("tutorials_created_at_idx").on(table.createdAt),
    categoryIdx: index("tutorials_category_idx").on(table.category),
    youtubeVideoIdIdx: index("tutorials_youtube_video_id_idx").on(table.youtubeVideoId),
  }
})

export type Tutorial = typeof tutorials.$inferSelect
export type NewTutorial = typeof tutorials.$inferInsert
