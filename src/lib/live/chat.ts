import { labChannel, userChannel } from './names'
import { publishLive } from './publish'

/**
 * Live events of a case chat. They go to the people who may open it (canAccessCaseChat): everyone in the lab,
 * the staff on the case, and admins.
 */
export async function publishChat(
  caseRecord: { id: string; clientId: string; subuserId: string | null },
  /** resolveCaseChatParticipantIds(): the lab's people among them hear it on the lab's channel instead. */
  participantIds: string[],
  kind: 'new' | 'changed',
): Promise<void> {
  const staff = participantIds.filter((id) => id !== caseRecord.clientId && id !== caseRecord.subuserId)
  const event = { type: 'chat', caseId: caseRecord.id, kind }
  await Promise.all([labChannel(caseRecord.clientId), ...staff.map(userChannel)].map((channel) => publishLive(channel, event)))
}

/** This person has seen the chat (or just wrote in it): its badge goes off on all their devices. */
export const publishChatRead = (userId: string, caseId: string) =>
  publishLive(userChannel(userId), { type: 'chat-read', caseId } as { type: string })
