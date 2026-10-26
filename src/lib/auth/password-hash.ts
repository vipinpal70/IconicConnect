import argon2 from 'argon2'
import bcrypt from 'bcryptjs'

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

let dummyHashPromise: Promise<string> | undefined

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS)
}

export type PasswordVerification = {
  valid: boolean
  needsRehash: boolean
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<PasswordVerification> {
  if (!storedHash) {
    dummyHashPromise ??= hashPassword('not-a-real-password')
    await argon2.verify(await dummyHashPromise, password).catch(() => false)
    return { valid: false, needsRehash: false }
  }

  if (storedHash.startsWith('$argon2')) {
    const valid = await argon2.verify(storedHash, password).catch(() => false)
    return {
      valid,
      needsRehash: valid && argon2.needsRehash(storedHash, ARGON_OPTIONS),
    }
  }

  if (/^\$2[aby]\$/.test(storedHash)) {
    const valid = await bcrypt.compare(password, storedHash).catch(() => false)
    return { valid, needsRehash: valid }
  }

  return { valid: false, needsRehash: false }
}
