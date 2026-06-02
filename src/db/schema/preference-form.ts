import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core"
import { profiles } from "./profile"
import type { PreferenceFormPayload } from "@/src/lib/preference-forms"

export const preferenceForms = pgTable(
  "preference_forms",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    formName: varchar("form_name", { length: 150 }).notNull(),
    payload: jsonb("payload").$type<PreferenceFormPayload>().notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index("preference_forms_client_idx").on(table.clientId),
  })
)

export type PreferenceForm = typeof preferenceForms.$inferSelect
export type NewPreferenceForm = typeof preferenceForms.$inferInsert
