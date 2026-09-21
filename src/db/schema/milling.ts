import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  text,
  jsonb,
  date,
  index,
  unique,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { unitTypeEnum } from './price-list'
import { cases, serviceTypeEnum } from './case'
import { profiles } from './profile'

// Mirrors the milling-stage subset of case_status (case.ts) as its own
// Postgres enum type, scoped to just the values a milling assignment can be in.
export const millingStatusEnum = pgEnum('milling_status', [
  'ready_for_milling',
  'milling_in_progress',
  'milling_qc',
  'dispatched',
  'delivered',
])

// What a centre is on the hook for on a given case — drives which of
// designCenterId/productionCenterId on milling_case_assignments is set.
// See case-flow-update-plan.md §5.1.
export const assignmentScopeEnum = pgEnum('assignment_scope', [
  'design',
  'milling',
  'design_milling',
])

// case_center_assignment_history — which leg of the case an event is about.
export const assignmentRoleEnum = pgEnum('assignment_role', ['design', 'milling'])

// case_center_assignment_history — what happened to that leg's assignment.
export const assignmentActionEnum = pgEnum('assignment_action', [
  'assigned',
  'reassigned',
  'withdrawn',
  'auto_advanced',
])

export const millingCenters = pgTable('milling_centers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 150 }).notNull(),
  legalName: varchar('legal_name', { length: 200 }),
  contactName: varchar('contact_name', { length: 100 }), // POC name
  email: varchar('email', { length: 255 }), // POC email — used for login
  phone: varchar('phone', { length: 20 }), // POC phone

  ownerName: varchar('owner_name', { length: 100 }),
  ownerEmail: varchar('owner_email', { length: 255 }),
  ownerPhone: varchar('owner_phone', { length: 20 }),

  financePocName: varchar('finance_poc_name', { length: 100 }),
  financePocEmail: varchar('finance_poc_email', { length: 255 }),
  financePocPhone: varchar('finance_poc_phone', { length: 20 }),

  contractDocKey: text('contract_doc_key'),
  contractDocName: varchar('contract_doc_name', { length: 255 }),
  contractDocUploadedAt: timestamp('contract_doc_uploaded_at'),

  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  country: varchar('country', { length: 100 }),

  // e.g. ['CA','NY'] — literal ['ALL'] sentinel means all states served
  statesServed: text('states_served').array(),
  avgTatDays: integer('avg_tat_days'),
  enabledServiceTypes: text('enabled_service_types').array().notNull().default(sql`'{}'::text[]`),

  active: boolean('active').default(true).notNull(),
  onboardedAt: date('onboarded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const millingServiceCatalog = pgTable(
  'milling_service_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    millingCenterId: uuid('milling_center_id')
      .references(() => millingCenters.id, { onDelete: 'cascade' })
      .notNull(),
    // Which of the 3 client-facing flows this catalog row belongs to.
    serviceType: serviceTypeEnum('service_type').notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    subCategory: varchar('sub_category', { length: 100 }).notNull(),
    unitType: unitTypeEnum('unit_type').notNull(),
    // Internal cost — what the milling centre charges Iconic. Never used to
    // auto-compute the client-facing Design+Milling price (see service_catalog.service_type).
    partnerRate: numeric('partner_rate', { precision: 10, scale: 2 }).notNull(),
    monthlyCapacity: integer('monthly_capacity'),
    turnaroundDays: integer('turnaround_days'),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    millingCenterIdIdx: index('milling_service_catalog_center_id_idx').on(table.millingCenterId),
    centerServiceTypeCategoryUniq: unique('milling_service_catalog_center_type_category_uniq').on(
      table.millingCenterId,
      table.serviceType,
      table.category,
      table.subCategory
    ),
  })
)

export const millingRoutingRules = pgTable(
  'milling_routing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull(),
    priority: integer('priority').default(10).notNull(),
    // { countries?, states?, excludeStates?, clients?, products?, restorations? }
    scope: jsonb('scope').notNull(),
    millingCenterId: uuid('milling_center_id')
      .references(() => millingCenters.id, { onDelete: 'cascade' })
      .notNull(),
    fallbackMillingCenterId: uuid('fallback_milling_center_id').references(() => millingCenters.id),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    priorityIdx: index('milling_routing_rules_priority_idx').on(table.priority),
    millingCenterIdIdx: index('milling_routing_rules_center_id_idx').on(table.millingCenterId),
  })
)

// One row per case — the *current* state of who's handling it. Full history
// of every assign/reassign/withdraw is in caseCenterAssignmentHistory below;
// this table only ever reflects "right now." See case-flow-update-plan.md §5.1.
export const millingCaseAssignments = pgTable(
  'milling_case_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .references(() => cases.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    // Which of the 3 flow decisions this assignment represents — kept in
    // sync with which of the two center-id columns below are populated.
    scope: assignmentScopeEnum('scope').notNull().default('milling'),
    // Set when a centre is designing this case (Flow 1 / Flow 3).
    designCenterId: uuid('design_center_id').references(() => millingCenters.id),
    // Set when a centre is manufacturing this case (Flow 2 / Flow 3, or milling_only).
    productionCenterId: uuid('production_center_id').references(() => millingCenters.id),
    // Set only when scope = 'design_milling': the moment QC approves, the
    // case auto-advances into production under productionCenterId with no
    // separate admin "assign milling centre" action. See case-flow-update-plan.md §7.3.
    autoAdvanceToMilling: boolean('auto_advance_to_milling').default(false).notNull(),
    // Null while the case is purely in the design stage (no production leg
    // yet) — only meaningful once productionCenterId is set.
    millingStatus: millingStatusEnum('milling_status'),
    carrier: varchar('carrier', { length: 50 }),
    trackingNumber: varchar('tracking_number', { length: 100 }),
    shipmentEta: date('shipment_eta'),
    notes: text('notes'),
    // The only client-identifying fields ever exposed to a milling centre —
    // needed to ship the physical product. Everything else about the dental
    // lab (email, phone, other PII, pricing) is stripped from milling APIs.
    shipToName: varchar('ship_to_name', { length: 150 }),
    shipToAddress: text('ship_to_address'),
    designAssignedAt: timestamp('design_assigned_at'),
    productionAssignedAt: timestamp('production_assigned_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    designCenterIdIdx: index('milling_case_assignments_design_center_id_idx').on(table.designCenterId),
    productionCenterIdIdx: index('milling_case_assignments_production_center_id_idx').on(table.productionCenterId),
  })
)

// Append-only audit log of every assignment/reassignment/withdrawal on
// either leg of a case — case-flow-update-plan.md §5.1a. millingCaseAssignments
// above only ever holds current state; this table is what makes "Centre B was
// tried and went inactive, Centre C took over" queryable.
export const caseCenterAssignmentHistory = pgTable(
  'case_center_assignment_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .references(() => cases.id, { onDelete: 'cascade' })
      .notNull(),
    role: assignmentRoleEnum('role').notNull(),
    action: assignmentActionEnum('action').notNull(),
    // The centre *after* this event; null = withdrawn back to unassigned/internal.
    millingCenterId: uuid('milling_center_id').references(() => millingCenters.id),
    // The centre *before* this event, if any.
    previousCenterId: uuid('previous_center_id').references(() => millingCenters.id),
    // Who performed it; null for 'auto_advanced' (system-triggered).
    actorId: uuid('actor_id').references(() => profiles.id),
    reason: text('reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    caseIdIdx: index('case_center_assignment_history_case_id_idx').on(table.caseId),
  })
)

export type MillingCenter = typeof millingCenters.$inferSelect
export type NewMillingCenter = typeof millingCenters.$inferInsert
export type MillingServiceCatalogItem = typeof millingServiceCatalog.$inferSelect
export type NewMillingServiceCatalogItem = typeof millingServiceCatalog.$inferInsert
export type MillingRoutingRule = typeof millingRoutingRules.$inferSelect
export type NewMillingRoutingRule = typeof millingRoutingRules.$inferInsert
export type MillingCaseAssignment = typeof millingCaseAssignments.$inferSelect
export type NewMillingCaseAssignment = typeof millingCaseAssignments.$inferInsert
export type CaseCenterAssignmentHistoryEntry = typeof caseCenterAssignmentHistory.$inferSelect
export type NewCaseCenterAssignmentHistoryEntry = typeof caseCenterAssignmentHistory.$inferInsert
