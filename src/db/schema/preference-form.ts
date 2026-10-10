import { jsonb, boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core"
import { profiles } from "./profile"
import type { PreferenceFormPayload } from "@/src/lib/preference-forms"

export const preferenceForms = pgTable(
  "preference_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    formName: varchar("form_name", { length: 150 }).notNull(),
    payload: jsonb("payload").$type<PreferenceFormPayload>().notNull(),
    isSystemDefault: boolean("is_system_default").default(false).notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
)

export type PreferenceForm = typeof preferenceForms.$inferSelect
export type NewPreferenceForm = typeof preferenceForms.$inferInsert
