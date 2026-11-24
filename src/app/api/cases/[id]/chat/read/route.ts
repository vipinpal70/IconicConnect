import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/src/lib/auth/server'
import { markCaseChatRead, markChatNotificationsRead } from '@/src/lib/chat'
import { openChat } from '@/src/lib/chat-messages'

const schema = z.object({ messageId: z.uuid() })

/**
 * POST { messageId }: the caller has seen the chat up to this message. Sent by the browser only while the
 * chat is really on screen, so a forgotten background tab can't clear someone's unread badge.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { data: { user } } = await (await createClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = schema.safeParse(await req.json().catch(() => null))
    if (!body.success || !z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const chat = await openChat(id, user.id)
    if (chat.status !== 200) return NextResponse.json({ error: 'Not available' }, { status: chat.status })

    await markCaseChatRead(id, user.id, body.data.messageId)
    const notificationsRead = await markChatNotificationsRead(id, user.id, body.data.messageId)
    return NextResponse.json({ notificationsRead })
  } catch (error) {
    console.error('[case chat read]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
