import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
  text,
  customType,
} from 'drizzle-orm/pg-core'

// Mirrors db/migrations (dbmate owns the DDL; this file only types the queries).
const citext = customType<{ data: string }>({ dataType: () => 'citext' })

export const userTypeEnum = pgEnum('user_type', ['lab_portal', 'admin_portal'])
export const userRoleEnum = pgEnum('user_role', ['client', 'subuser', 'admin', 'qc', 'account_manager', 'designer'])
export const userStatusEnum = pgEnum('user_status', ['pending', 'active', 'inactive'])
export const planEnum = pgEnum('plan_status', ['trial', 'onboarded'])

/** Credentials only. Email lives here once (case-insensitive unique). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

  userType: userTypeEnum('user_type').notNull(),
  role: userRoleEnum('user_role').notNull(),
  status: userStatusEnum('user_status').default('pending').notNull(),
  plan: planEnum('plan_status'),

  /** Effective lab: client → own id, subuser → parent client, staff → null. Replaces resolveClientId + sub_users. */
  clientId: uuid('client_id'),
  /** Who created this sub-user / staff member. */
  createdBy: uuid('created_by'),

  fullName: varchar('full_name', { length: 150 }),
  title: varchar('title', { length: 100 }),
  phone: varchar('phone', { length: 30 }),
  labName: varchar('lab_name', { length: 150 }),
  postalCode: varchar('postal_code', { length: 20 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  country: varchar('country', { length: 100 }),

  onBoardedAt: timestamp('onboarded_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  roleStatusIdx: index('idx_profiles_role_status').on(table.role, table.status),
}))

export type User = typeof users.$inferSelect
export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
