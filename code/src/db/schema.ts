import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Personal Info
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  phone: varchar('phone', { length: 20 }),

  // Location
  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  country: varchar('country', { length: 100 }),

  // Lab
  labName: varchar('lab_name', { length: 150 }),

  // Auth
  password: text('password').notNull(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert