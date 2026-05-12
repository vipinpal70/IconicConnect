import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core'

export const userTypeEnum = pgEnum('user_type', [
  'lab_portal',           // client side
  'admin_portal',   // admin/owner side
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
])

export const profiles = pgTable('profiles', {
  id:         uuid('id').primaryKey(),        // = auth.users.id

  // Type & Role
  userType:   userTypeEnum('user_type').notNull(),
  role:       userRoleEnum('user_role').notNull(),

  // Personal
  fullName:   varchar('full_name',   { length: 100 }),
  title:      varchar('title',       { length: 50  }),
  email:      varchar('email',       { length: 255 }).notNull().unique(),
  phone:      varchar('phone',       { length: 20  }),

  // Lab
  labName:    varchar('lab_name',    { length: 150 }),

  // Location
  postalCode: varchar('postal_code', { length: 20  }),
  city:       varchar('city',        { length: 100 }),
  state:      varchar('state',       { length: 100 }),
  country:    varchar('country',     { length: 100 }),

  // Subuser / team member: who created them
  createdBy:  uuid('created_by'),               // parent user's id

  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
})

export type Profile    = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert