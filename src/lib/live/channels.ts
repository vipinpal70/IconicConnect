import type { SessionData } from '@/src/lib/auth/session'
import { isValidRoleForType, type UserRole } from '@/src/lib/auth/role'
import { isAgentRole, isCustomerRole } from '@/src/lib/support/constants'
import { agentsChannel, labChannel as supportLabChannel } from '@/src/lib/support/channels'
import { allLabsChannel, labChannel, staffChannel, userChannel } from './names'

/** What changed, from a browser's point of view. Each area is one channel and one counter. */
export type LiveArea = 'user' | 'lab' | 'labs' | 'staff' | 'support'

/** What a person may hear about: decided by the session, never by the browser. */
export function channelsFor(session: Pick<SessionData, 'userId' | 'role' | 'clientId'>): Array<{ area: LiveArea; channel: string }> {
  const channels: Array<{ area: LiveArea; channel: string }> = [{ area: 'user', channel: userChannel(session.userId) }]
  if (isCustomerRole(session.role)) {
    if (!session.clientId) return channels
    channels.push(
      { area: 'lab', channel: labChannel(session.clientId) },
      { area: 'labs', channel: allLabsChannel },
      { area: 'support', channel: supportLabChannel(session.clientId) },
    )
    return channels
  }
  // An allow-list: a role nobody decided about hears nothing shared
  if (!isValidRoleForType('admin_portal', session.role as UserRole)) return channels
  channels.push({ area: 'staff', channel: staffChannel })
  if (isAgentRole(session.role)) channels.push({ area: 'support', channel: agentsChannel })
  return channels
}
