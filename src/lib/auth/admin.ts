import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { authCredentials } from '@/src/db/schema/auth-credentials'
import { destroyAllSessions } from './session'
import { hashPassword } from './password-hash'

type AdminUser = {
  id: string
  email: string
  created_at: string
}

type AdminError = { message: string }

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return 'An account with this email already exists.'
  }
  if (error instanceof Error) return error.message
  return 'Authentication operation failed.'
}

export const authAdmin = {
  createUser: async (input: {
    email: string
    password?: string
    phone?: string
    email_confirm?: boolean
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  }): Promise<{ data: { user: AdminUser | null }; error: AdminError | null }> => {
    try {
      const email = input.email.trim().toLowerCase()
      if (!email || email.length > 254) throw new Error('A valid email address is required.')
      const userId = randomUUID()
      const createdAt = new Date()
      await db.insert(authCredentials).values({
        userId,
        email,
        phone: input.phone ?? null,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        emailVerifiedAt: input.email_confirm ? createdAt : null,
        userMetadata: input.user_metadata ?? {},
        appMetadata: input.app_metadata ?? {},
      })
      return {
        data: { user: { id: userId, email, created_at: createdAt.toISOString() } },
        error: null,
      }
    } catch (error) {
      return { data: { user: null }, error: { message: getErrorMessage(error) } }
    }
  },

  updateUserById: async (
    userId: string,
    input: {
      email?: string
      password?: string
      phone?: string
      email_confirm?: boolean
      user_metadata?: Record<string, unknown>
      app_metadata?: Record<string, unknown>
    },
  ): Promise<{ data: { user: { id: string } | null }; error: AdminError | null }> => {
    try {
      const values: Partial<typeof authCredentials.$inferInsert> = { updatedAt: new Date() }
      let passwordChanged = false
      if (typeof input.email === 'string') values.email = input.email.trim().toLowerCase()
      if (typeof input.phone === 'string') values.phone = input.phone
      if (typeof input.password === 'string') {
        values.passwordHash = await hashPassword(input.password)
        values.passwordChangedAt = new Date()
        passwordChanged = true
      }
      if (typeof input.email_confirm === 'boolean') {
        values.emailVerifiedAt = input.email_confirm ? new Date() : null
      }
      if (input.user_metadata) values.userMetadata = input.user_metadata
      if (input.app_metadata) values.appMetadata = input.app_metadata

      if (passwordChanged) await destroyAllSessions(userId)
      const [updated] = await db.update(authCredentials)
        .set(values)
        .where(eq(authCredentials.userId, userId))
        .returning({ userId: authCredentials.userId })
      if (!updated) throw new Error('User not found in the authentication database.')
      return { data: { user: { id: userId } }, error: null }
    } catch (error) {
      return { data: { user: null }, error: { message: getErrorMessage(error) } }
    }
  },

  deleteUser: async (
    userId: string,
  ): Promise<{ data: { user: { id: string } | null }; error: AdminError | null }> => {
    try {
      const [existing] = await db.select({ userId: authCredentials.userId })
        .from(authCredentials)
        .where(eq(authCredentials.userId, userId))
        .limit(1)
      if (!existing) throw new Error('User not found in the authentication database.')
      await destroyAllSessions(userId)
      const [deleted] = await db.delete(authCredentials)
        .where(eq(authCredentials.userId, userId))
        .returning({ userId: authCredentials.userId })
      if (!deleted) throw new Error('User was already deleted.')
      return { data: { user: { id: userId } }, error: null }
    } catch (error) {
      return { data: { user: null }, error: { message: getErrorMessage(error) } }
    }
  },
}
