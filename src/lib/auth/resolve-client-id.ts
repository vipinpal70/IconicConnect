import type { Profile } from '@/src/db/schema/profile'

/**
 * Returns the effective client ID for any lab-portal user.
 * Sub-users share the parent client's data — use createdBy as their identity.
 */
export function resolveClientId(profile: Pick<Profile, 'id' | 'role' | 'createdBy'>): string {
  if (profile.role === 'subuser' && profile.createdBy) {
    return profile.createdBy
  }
  return profile.id
}

export function isLabUser(profile: Pick<Profile, 'role'>): boolean {
  return profile.role === 'client' || profile.role === 'subuser'
}
