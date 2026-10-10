import { describe, expect, it } from 'vitest'
import { describeDbError } from '../db-error'

describe('describeDbError', () => {
  it('reads the Postgres cause hidden under Drizzle\'s "Failed query" wrapper and never includes SQL params', () => {
    const err = Object.assign(new Error('Failed query: select * from "profiles" where id = $1\nparams: 3f2a-secret-user-id'), {
      cause: Object.assign(new Error('relation "profiles" does not exist'), { code: '42P01', table_name: 'profiles' }),
    })
    const d = describeDbError(err)
    expect(d.code).toBe('42P01')
    expect(d.message).toBe('relation "profiles" does not exist')
    expect(d.kind).toMatch(/migrations/)
    expect(JSON.stringify(d)).not.toMatch(/secret-user-id|params/)
  })

  it('classifies the usual production culprits', () => {
    const cause = (code: string, message: string) => ({ cause: Object.assign(new Error(message), { code }) })
    expect(describeDbError(cause('42703', 'column "client_id" does not exist')).kind).toMatch(/schema/)
    expect(describeDbError(cause('28P01', 'password authentication failed')).kind).toMatch(/credentials/)
    expect(describeDbError(cause('53300', 'sorry, too many clients already')).kind).toMatch(/connection limit/)
    expect(describeDbError(new Error('connect ECONNREFUSED 127.0.0.1:5432')).kind).toMatch(/unreachable/)
    expect(describeDbError(new Error('SSL connection is required')).kind).toMatch(/SSL/)
  })

  it('survives non-Error values', () => {
    expect(describeDbError('boom').message).toBe('boom')
    expect(describeDbError(null).message).toBeTruthy()
  })
})
