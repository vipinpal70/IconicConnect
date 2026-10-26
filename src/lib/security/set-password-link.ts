import { createHash, randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { authCredentials, authRecoveryTokens } from '@/src/db/schema'
import { profiles } from '@/src/db/schema/profile'

/**
 * One-time "set your password" link for new/reset accounts, so credentials emails never contain a
 * plaintext password (mailboxes, forwarding, queue payloads and email logs all retain it forever).
 * Returns null on failure — callers fall back to telling the user to use "Forgot password".
 */
export async function createSetPasswordLink(email: string): Promise<string | null> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL
    if (!origin) return null
    const normalizedEmail = email.trim().toLowerCase()
    const [profile] = await db.select({ userId: profiles.id })
      .from(profiles)
      .where(sql`lower(${profiles.email}) = ${normalizedEmail}`)
      .limit(1)
    if (!profile) return null

    const [credential] = await db.select({ userId: authCredentials.userId })
      .from(authCredentials)
      .where(eq(authCredentials.userId, profile.userId))
      .limit(1)
    if (!credential) {
      await db.insert(authCredentials).values({
        userId: profile.userId,
        email: normalizedEmail,
        passwordHash: null,
      })
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await db.delete(authRecoveryTokens).where(eq(authRecoveryTokens.userId, profile.userId))
    await db.insert(authRecoveryTokens).values({
      tokenHash,
      userId: profile.userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    return `${origin}/auth/verify?token=${encodeURIComponent(token)}`
  } catch (error) {
    console.error('[set-password-link] failed:', error)
    return null
  }
}

/** HTML block replacing the old "Password: xxxx" row. */
export function setPasswordBlock(link: string | null, appUrl: string): string {
  return link
    ? `<p style="margin:12px 0 4px;"><a href="${link}" style="display:inline-block;background:#00786f;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Set your password</a></p>
       <p style="margin:4px 0;font-size:12px;color:#6b7280;">This one-time link expires in 1 hour. If it has expired, use “Forgot password” at ${appUrl}/auth/sign-in.</p>`
    : `<p style="margin:4px 0;font-size:13px;color:#374151;">To choose your password, open ${appUrl}/auth/sign-in and use “Forgot password”.</p>`
}
