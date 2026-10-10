import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  text,
  jsonb,
  date,
  boolean,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { profiles } from './profile'
import { cases } from './case'

export const adjustmentTypeEnum = pgEnum('adjustment_type', ['percent', 'fixed'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid'])

export type InvoiceStatus = 'pending' | 'paid'
export type AdjustmentType = 'percent' | 'fixed'

export type InvoiceLineItem = {
  sno: number
  description: string
  qty: number
  unitPrice: number
  totalPrice: number
  // Optional — populated for line items built from buildInvoiceItems(). Absent
  // on older invoices (which may also carry a legacy `serviceType` key, ignored).
  category?: string
  subCategory?: string
}

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).unique().notNull().default(sql`next_invoice_number()`),
    clientId: uuid('client_id')
      .references(() => profiles.id, { onDelete: 'restrict' })
      .notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    items: jsonb('items')
      .$type<InvoiceLineItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),

    taxType: adjustmentTypeEnum('tax_type').notNull().default('percent'),
    taxValue: numeric('tax_value', { precision: 12, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),

    discountType: adjustmentTypeEnum('discount_type').notNull().default('percent'),
    discountValue: numeric('discount_value', { precision: 12, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),

    extraChargesType: adjustmentTypeEnum('extra_charges_type').notNull().default('percent'),
    extraChargesValue: numeric('extra_charges_value', { precision: 12, scale: 2 }).notNull().default('0'),
    extraChargesAmount: numeric('extra_charges_amount', { precision: 12, scale: 2 }).notNull().default('0'),

    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    status: invoiceStatusEnum('status').notNull().default('pending'),
    remarks: text('remarks'),
    termsOfPayment: varchar('terms_of_payment', { length: 100 }).default('7 Days'),
    // Client payment tracking
    clientPaid: boolean('client_paid').notNull().default(false),
    clientPaymentDate: date('client_payment_date'),

    // Admin receipt confirmation
    received: boolean('received').notNull().default(false),
    receivedConfirmationId: varchar('received_confirmation_id', { length: 100 }),
    receivedOn: date('received_on'),


    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
)

/** A case may sit on more than one invoice; the API warns before re-billing (no UNIQUE(case_id)). */
export const invoiceCases = pgTable('invoice_cases', {
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'restrict' }).notNull(),
  addedBy: uuid('added_by').references(() => profiles.id, { onDelete: 'set null' }),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.invoiceId, t.caseId] }) }))

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
