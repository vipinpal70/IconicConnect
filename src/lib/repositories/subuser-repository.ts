import { db } from '@/src/db'
import { profiles, subUsers, type Profile, type SubUser } from '@/src/db/schema/profile'
import { eq, and } from 'drizzle-orm'

export interface ISubUserRepository {
  listByClientId(clientId: string): Promise<Profile[]>
  create(profileData: typeof profiles.$inferInsert, clientId: string): Promise<Profile>
  delete(subUserId: string, clientId: string): Promise<void>
}

export class SubUserRepository implements ISubUserRepository {
  async listByClientId(clientId: string): Promise<Profile[]> {
    return db
      .select()
      .from(profiles)
      .where(and(eq(profiles.createdBy, clientId), eq(profiles.role, 'subuser')))
  }

  async create(profileData: typeof profiles.$inferInsert, clientId: string): Promise<Profile> {
    return db.transaction(async (tx) => {
      // 1. Insert profile
      const [newProfile] = await tx.insert(profiles).values(profileData).returning()

      // 2. Link in sub_users table
      await tx.insert(subUsers).values({
        id: newProfile.id,
        profileId: newProfile.id,
        clientId: clientId,
      })

      return newProfile
    })
  }

  async delete(subUserId: string, clientId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // 1. Delete mapping record
      await tx
        .delete(subUsers)
        .where(and(eq(subUsers.profileId, subUserId), eq(subUsers.clientId, clientId)))

      // 2. Delete profile
      await tx
        .delete(profiles)
        .where(and(eq(profiles.id, subUserId), eq(profiles.createdBy, clientId)))
    })
  }
}
