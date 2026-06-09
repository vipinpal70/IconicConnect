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
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { profiles } from './profile'

export type InvoiceStatus = 'pending' | 'paid'
export type AdjustmentType = 'percent' | 'fixed'

export type InvoiceLineItem = {
  sno: number
  description: string
  qty: number
  unitPrice: number
  totalPrice: number
}

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).unique().notNull(),
    clientId: uuid('client_id')
      .references(() => profiles.id, { onDelete: 'restrict' })
      .notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    items: jsonb('items')
      .$type<InvoiceLineItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull().default('0'),

    taxType: varchar('tax_type', { length: 10 }).notNull().default('percent'),
    taxValue: numeric('tax_value', { precision: 10, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 10, scale: 2 }).notNull().default('0'),

    discountType: varchar('discount_type', { length: 10 }).notNull().default('percent'),
    discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 10, scale: 2 }).notNull().default('0'),

    extraChargesType: varchar('extra_charges_type', { length: 10 }).notNull().default('percent'),
    extraChargesValue: numeric('extra_charges_value', { precision: 10, scale: 2 }).notNull().default('0'),
    extraChargesAmount: numeric('extra_charges_amount', { precision: 10, scale: 2 }).notNull().default('0'),

    total: numeric('total', { precision: 10, scale: 2 }).notNull().default('0'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    remarks: text('remarks'),
    termsOfPayment: varchar('terms_of_payment', { length: 100 }).default('7 Days'),
    // Client payment tracking
    clientPaid: boolean('client_paid').notNull().default(false),
    clientPaymentDate: date('client_payment_date'),

    // Admin receipt confirmation
    received: boolean('received').notNull().default(false),
    receivedConfirmationId: varchar('received_confirmation_id', { length: 100 }),
    receivedOn: date('received_on'),

    caseIds: jsonb('case_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index('invoices_client_id_idx').on(table.clientId),
    statusIdx: index('invoices_status_idx').on(table.status),
  })
)

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
