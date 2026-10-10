import argon2 from 'argon2'
import bcrypt from 'bcryptjs'

// OWASP-recommended argon2id floor (19 MiB, t=2, p=1) — ~30-50 ms per hash on a server core.
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export const hashPassword = (plain: string) => argon2.hash(plain, ARGON_OPTS)

// Computed once so a login for an unknown email costs the same as a real one (no user enumeration by timing).
let dummy: Promise<string> | null = null
const dummyHash = () => (dummy ??= hashPassword('not-a-real-password'))

export type VerifyResult = { ok: boolean; needsRehash: boolean }

/** Accepts argon2id hashes and legacy Supabase bcrypt ($2a/$2b) hashes; bcrypt matches ask to be re-hashed. */
export async function verifyPassword(plain: string, stored: string | null): Promise<VerifyResult> {
  if (!stored) {
    await argon2.verify(await dummyHash(), plain).catch(() => false)
    return { ok: false, needsRehash: false }
  }
  if (stored.startsWith('$argon2')) {
    const ok = await argon2.verify(stored, plain).catch(() => false)
    return { ok, needsRehash: ok && argon2.needsRehash(stored, ARGON_OPTS) }
  }
  if (stored.startsWith('$2')) {
    const ok = await bcrypt.compare(plain, stored).catch(() => false)
    return { ok, needsRehash: ok }
  }
  return { ok: false, needsRehash: false }
}
