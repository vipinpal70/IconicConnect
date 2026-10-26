'use client'

import type { AuthUser } from './types'

type AuthResult<T> = {
  data: T | null
  error: { message: string } | null
}

async function request<T>(path: string, init?: RequestInit): Promise<AuthResult<T>> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : 'Authentication request failed.'
    return {
      data: null,
      error: { message },
    }
  }
  return { data: body as T, error: null }
}

export function createClient() {
  return {
    auth: {
      getUser: async () => {
        const result = await request<{ user: AuthUser | null }>('/api/auth/me')
        return {
          data: { user: result.data?.user ?? null },
          error: result.error,
        }
      },
      getSession: async () => {
        const result = await request<{ user: AuthUser | null }>('/api/auth/me')
        return {
          data: { session: result.data?.user ? { user: result.data.user } : null },
          error: result.error,
        }
      },
      signOut: async () => {
        const result = await request('/api/auth/sign-out', { method: 'POST' })
        return { error: result.error }
      },
      signUp: async (input: { email: string; password: string; phone?: string }) =>
        request<{ user: AuthUser | null }>('/api/sign-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      updateUser: async (input: { password: string; token?: string }) =>
        request('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
    },
  }
}
