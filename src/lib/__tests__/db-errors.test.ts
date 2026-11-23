import { describe, expect, it } from 'vitest'
import { isUniqueViolation, pgErrorOf } from '@/src/lib/db-errors'

/** What postgres-js throws, and what Drizzle wraps it in ("Failed query: …", original on `cause`). */
const driverError = (code: string, constraint?: string) => Object.assign(new Error('duplicate key value'), { code, constraint_name: constraint })
const drizzleWrapped = (inner: Error) => Object.assign(new Error('Failed query: insert into "users" …'), { cause: inner })

describe('Postgres error helpers', () => {
  it('finds a unique violation thrown directly by the driver', () => {
    expect(isUniqueViolation(driverError('23505', 'users_email_key'))).toBe(true)
  })

  it('finds it through Drizzle\'s wrapper (the bug: the top level has no code)', () => {
    const wrapped = drizzleWrapped(driverError('23505', 'users_email_key'))
    expect((wrapped as { code?: string }).code).toBeUndefined()
    expect(isUniqueViolation(wrapped)).toBe(true)
    expect(isUniqueViolation(drizzleWrapped(drizzleWrapped(driverError('23505'))))).toBe(true)
  })

  it('matches a specific constraint, so a lab-name clash is not reported as an email clash', () => {
    const labName = drizzleWrapped(driverError('23505', 'uq_profiles_lab_name'))
    expect(isUniqueViolation(labName, 'uq_profiles_lab_name')).toBe(true)
    expect(isUniqueViolation(labName, 'users_email_key')).toBe(false)
  })

  it('ignores other errors', () => {
    expect(isUniqueViolation(drizzleWrapped(driverError('23503')))).toBe(false) // foreign key
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
    // Node errors also have a `code` ("ECONNREFUSED"); that is not a Postgres error
    expect(pgErrorOf(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeNull()
  })

  it('stops on cyclic causes', () => {
    const a: { cause?: unknown } = {}
    a.cause = a
    expect(isUniqueViolation(a)).toBe(false)
  })
})
