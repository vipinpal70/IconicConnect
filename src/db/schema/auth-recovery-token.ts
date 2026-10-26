import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const authRecoveryTokens = pgTable('auth_recovery_tokens', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: uuid('user_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIndex: index('auth_recovery_tokens_user_id_idx').on(table.userId),
}))
