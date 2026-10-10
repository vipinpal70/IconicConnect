import { describe, expect, it, vi } from 'vitest'

// Do not open a real connection: the module is exercised through its pure helpers only.
vi.mock('ioredis', () => ({ default: class { status = 'ready'; on() { return this } once() { return this } off() { return this } } }))

import { guarded, isRedisProblem, RedisUnavailableError } from '../redis'

describe('request-path Redis guard', () => {
  it('recognises connection-level failures (so callers answer 503, not 500)', () => {
    expect(isRedisProblem(new Error('Command timed out'))).toBe(true)
    expect(isRedisProblem(new Error('connect ECONNREFUSED 127.0.0.1:6379'))).toBe(true)
    expect(isRedisProblem(new RedisUnavailableError())).toBe(true)
    expect(isRedisProblem(new Error('some unrelated bug'))).toBe(false)
  })

  it('opens the circuit after a connection failure: later calls fail instantly without touching Redis', async () => {
    await expect(guarded(async () => { throw new Error('Command timed out') })).rejects.toThrow('Command timed out')
    const probe = vi.fn(async () => 'ok')
    await expect(guarded(probe)).rejects.toBeInstanceOf(RedisUnavailableError)
    expect(probe).not.toHaveBeenCalled()
  })
})
