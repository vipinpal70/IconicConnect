import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const authCredentials = pgTable('auth_credentials', {
  userId: uuid('user_id').primaryKey(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 32 }),
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at'),
  phoneVerifiedAt: timestamp('phone_verified_at'),
  bannedUntil: timestamp('banned_until'),
  deletedAt: timestamp('deleted_at'),
  userMetadata: jsonb('user_metadata').$type<Record<string, unknown>>().default({}).notNull(),
  appMetadata: jsonb('app_metadata').$type<Record<string, unknown>>().default({}).notNull(),
  passwordChangedAt: timestamp('password_changed_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailUnique: uniqueIndex('auth_credentials_email_unique')
    .on(sql`lower(${table.email})`)
    .where(sql`${table.email} IS NOT NULL`),
}))

export type AuthCredential = typeof authCredentials.$inferSelect
export type NewAuthCredential = typeof authCredentials.$inferInsert
