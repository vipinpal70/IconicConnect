import { bigint, jsonb, pgTable, text, timestamp, uuid, customType } from 'drizzle-orm/pg-core'
import { users, citext } from './profile'

const inet = customType<{ data: string }>({ dataType: () => 'inet' })

/** Append-only security trail (enforced by a DB trigger — see migration 1800). Never UPDATE/DELETE from code. */
export const authAuditLog = pgTable('auth_audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // affected account
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }), // admin who did it, when not the account itself
  email: citext('email'),
  event: text('event').notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  details: jsonb('details').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type AuthAuditRow = typeof authAuditLog.$inferSelect
