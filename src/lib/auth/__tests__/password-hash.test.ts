import { describe, expect, it } from 'vitest'
import argon2 from 'argon2'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from '../password-hash'

describe('password hashing', () => {
  it('hashes new passwords with Argon2id', async () => {
    const hash = await hashPassword('S3cure-Password!')

    expect(hash.startsWith('$argon2id$')).toBe(true)
    await expect(argon2.verify(hash, 'S3cure-Password!')).resolves.toBe(true)
  })

  it('accepts legacy Supabase bcrypt hashes and requests a rehash', async () => {
    const legacyHash = await bcrypt.hash('S3cure-Password!', 10)

    await expect(verifyPassword('S3cure-Password!', legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    })
  })

  it('rejects unknown, malformed, and incorrect credentials', async () => {
    const hash = await hashPassword('S3cure-Password!')

    await expect(verifyPassword('wrong', hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    })
    await expect(verifyPassword('anything', null)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    })
    await expect(verifyPassword('anything', '$2b$invalid')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    })
  })
})
