import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
  text,
  boolean,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userTypeEnum = pgEnum('user_type', [
  'lab_portal',           // client side
  'admin_portal',   // admin/owner side
  'milling_portal', // milling centre partner side
])

export const userRoleEnum = pgEnum('user_role', [
  // lab_portal roles
  'client',
  'subuser',
  // admin_portal roles
  'admin',
  'qc',
  'account_manager',
  'designer',
  'consultant',
  // milling_portal roles
  'milling_admin',
  'milling_production',
  'milling_support',
])

export const userStatusEnum = pgEnum('user_status', [
  'pending',
  'active',
  'inactive',
])

export const planEnum = pgEnum('plan_status', [
  'Trial',
  'Onboarded',
])

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),        // = auth.users.id

  // Type & Role
  userType: userTypeEnum('user_type').notNull(),
  role: userRoleEnum('user_role').notNull(),
  status: userStatusEnum('user_status').default('pending').notNull(),
  plan: planEnum('plan_status').default('Trial'), // Only for client/subuser

  // Personal
  fullName: varchar('full_name', { length: 100 }),
  title: varchar('title', { length: 50 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  phone: varchar('phone', { length: 20 }),

  // Lab
  labName: varchar('lab_name', { length: 150 }),

  // Location
  postalCode: varchar('postal_code', { length: 20 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  country: varchar('country', { length: 100 }),

  // Subuser / team member: who created them
  createdBy: uuid('created_by'),               // parent user's id
  password: varchar('password', { length: 255 }),

  // Milling portal: which centre this user belongs to (FK enforced in migration SQL,
  // not declared here, to avoid a schema-file import cycle with ./milling)
  millingCenterId: uuid('milling_center_id'),

  // Client-only: which of the 3 service flows (design_only/design_milling/
  // milling_only) this client can submit cases for and see pricing on.
  // Subusers inherit their parent client's value at read time.
  enabledServiceTypes: text('enabled_service_types')
    .array()
    .notNull()
    .default(sql`'{design_only}'::text[]`),

  // Client-only: when true, this lab may only create "3D Model" category cases —
  // every other case category is hidden/rejected for them.
  modelOnlyLab: boolean('model_only_lab').default(false).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  onBoardedAt: timestamp('onboarded_at'),
}, (table) => {
  return {
    roleIdx: index('role_idx').on(table.role),
    emailIdx: index('email_idx').on(table.email),
    createdByIdx: index('profiles_created_by_idx').on(table.createdBy),
    millingCenterIdIdx: index('profiles_milling_center_id_idx').on(table.millingCenterId),
  }
})

export const subUsers = pgTable('sub_users', {
  id: uuid('id').primaryKey(),        // = auth.users.id
  profileId: uuid('profile_id').references(() => profiles.id).notNull(),
  clientId: uuid('client_id').references(() => profiles.id).notNull(), // Parent client
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    clientIdx: index('sub_users_client_id_idx').on(table.clientId),
  }
})

export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
export type SubUser = typeof subUsers.$inferSelect
export type NewSubUser = typeof subUsers.$inferInsert