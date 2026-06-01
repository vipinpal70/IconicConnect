import { type ISubUserRepository } from '../repositories/subuser-repository'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { type Profile } from '@/src/db/schema/profile'
import { sendCredentialsEmail } from '@/src/lib/mailer'
import { NotificationService } from '@/src/lib/notifications/notification-service'
import { NotificationType } from '@/src/lib/notifications/notification-events'

export class SubUserService {
  constructor(private subUserRepo: ISubUserRepository) { }

  async getSubUsers(clientId: string): Promise<Profile[]> {
    return this.subUserRepo.listByClientId(clientId)
  }

  async createSubUser(
    clientId: string,
    data: {
      name: string
      username: string
      email: string
      role: 'Owner' | 'Manager' | 'Coordinator' | 'Technician'
      password?: string
    }
  ): Promise<Profile> {
    const { name, username, email, role, password } = data

    if (!name || !username || !email) {
      throw new Error('Name, username, and email are required')
    }

    // 1. Generate password if not provided
    const mainPassword = password || `Welcome@${Math.floor(1000 + Math.random() * 9000)}`

    // 2. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: mainPassword,
      email_confirm: true, // Immediately activate
    })

    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Failed to create user in Supabase Auth')
    }

    const userId = authData.user.id

    try {
      // 3. Create profile and mapping in DB
      const profile = await this.subUserRepo.create(
        {
          id: userId,
          userType: 'lab_portal',
          role: 'subuser',
          status: 'active', // Auto-activate
          fullName: name,
          title: role, // Store the sub-role (e.g. Manager) in the title field
          email,
          createdBy: clientId,
          password: mainPassword,
        },
        clientId
      )

      // 4. Send welcome credentials email
      await sendCredentialsEmail({
        email,
        password: mainPassword,
        name,
      }).catch((err) => {
        console.error('[WelcomeEmail] Failed to dispatch credentials email:', err)
      })

      // 5. Send welcome in-app notification
      await NotificationService.dispatch({
        type: NotificationType.WELCOME,
        actorUserId: clientId,
        targetUserId: userId,
        title: 'Welcome to IconicConnect',
        message: `Welcome ${name}! Your team member account has been successfully provisioned.`,
        link: '/client/dashboard',
      }).catch((err) => {
        console.error('[WelcomeNotification] Failed to dispatch welcome notification:', err)
      })

      return profile
    } catch (dbError) {
      // Rollback Auth user if database insertion fails
      await supabaseAdmin.auth.admin.deleteUser(userId).catch((err) => {
        console.error('Failed to rollback Supabase Auth user:', err)
      })
      throw dbError
    }
  }

  async deleteSubUser(subUserId: string, clientId: string): Promise<void> {
    // 1. List sub-users to verify ownership and ensure sub-user exists
    const subusers = await this.subUserRepo.listByClientId(clientId)
    const exists = subusers.some((u) => u.id === subUserId)

    if (!exists) {
      throw new Error('Sub-user not found or does not belong to this client')
    }

    // 2. Delete user in Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(subUserId)
    if (authError) {
      console.warn(`Supabase deleteUser warning: ${authError.message}`)
      // Proceed to DB deletion even if auth fails (e.g. if user was already deleted in auth)
    }

    // 3. Delete user database records
    await this.subUserRepo.delete(subUserId, clientId)
  }
}
