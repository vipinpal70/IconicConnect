import { db } from '@/src/db'
import { profiles, type Profile, type NewProfile } from '@/src/db/schema/profile'
import { eq, and } from 'drizzle-orm'
import { createUserWithProfile, deleteUser } from '@/src/lib/auth/auth-service'

export interface ISubUserRepository {
  listByClientId(clientId: string): Promise<Profile[]>
  create(profileData: Omit<NewProfile, 'id' | 'clientId'>, clientId: string, credentials: { email: string; password: string }): Promise<Profile>
  delete(subUserId: string, clientId: string): Promise<void>
}

export class SubUserRepository implements ISubUserRepository {
  async listByClientId(clientId: string): Promise<Profile[]> {
    // idx_profiles_client_id (partial, subusers only)
    return db.select().from(profiles).where(and(eq(profiles.clientId, clientId), eq(profiles.role, 'subuser')))
  }

  async create(profileData: Omit<NewProfile, 'id' | 'clientId'>, clientId: string, credentials: { email: string; password: string }): Promise<Profile> {
    const { id } = await createUserWithProfile({
      ...credentials,
      profile: { ...profileData, clientId },
    })
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    return profile
  }

  async delete(subUserId: string, clientId: string): Promise<void> {
    // Ownership check, then delete the login (profile + sessions go with it).
    const [owned] = await db.select({ id: profiles.id }).from(profiles)
      .where(and(eq(profiles.id, subUserId), eq(profiles.clientId, clientId), eq(profiles.role, 'subuser'))).limit(1)
    if (owned) await deleteUser(subUserId)
  }
}
