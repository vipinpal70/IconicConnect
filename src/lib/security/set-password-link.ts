import { supabaseAdmin } from '@/src/lib/supabase/admin'

/**
 * One-time "set your password" link for new/reset accounts, so credentials emails never contain a
 * plaintext password (mailboxes, forwarding, queue payloads and email logs all retain it forever).
 * Returns null on failure — callers fall back to telling the user to use "Forgot password".
 */
export async function createSetPasswordLink(email: string): Promise<string | null> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL
    if (!origin) return null
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${origin}/auth/reset-password` },
    })
    const tokenHash = data?.properties?.hashed_token
    if (error || !tokenHash) {
      console.error('[set-password-link] generateLink failed:', error)
      return null
    }
    return `${origin}/auth/verify?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=/auth/reset-password`
  } catch (err) {
    console.error('[set-password-link] failed:', err)
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
