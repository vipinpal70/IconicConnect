import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/auth/server'
import { ChatModifyError, deleteChatMessage, editChatMessage } from '@/src/lib/chat-modify'
import { MAX_CHAT_EDIT_LENGTH } from '@/src/lib/chat-rules'

type Context = { params: Promise<{ id: string; messageId: string }> }

const idsSchema = z.object({ id: z.uuid(), messageId: z.uuid() })
const editSchema = z.object({
  messageText: z.string().trim().min(1, 'Message text is required').max(MAX_CHAT_EDIT_LENGTH, 'Message is too long'),
})

async function requireProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new ChatModifyError(401, 'unauthorized', 'Unauthorized')
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) throw new ChatModifyError(404, 'not_found', 'Profile not found')
  return profile
}

async function parseIds(params: Context['params']) {
  const ids = idsSchema.safeParse(await params)
  if (!ids.success) throw new ChatModifyError(404, 'not_found', 'Message not found')
  return ids.data
}

function errorResponse(error: unknown) {
  if (error instanceof ChatModifyError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error('[case chat modify]', error)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/** PATCH { messageText }: the sender edits a message, within 2 minutes of sending it. */
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const profile = await requireProfile()
    const { id, messageId } = await parseIds(params)
    const body = editSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new ChatModifyError(400, 'invalid', body.error.issues[0]?.message ?? 'Invalid request')
    const message = await editChatMessage(profile, id, messageId, body.data.messageText)
    return NextResponse.json({ data: { id: message.id, messageText: message.messageText, editedAt: message.editedAt } })
  } catch (error) {
    return errorResponse(error)
  }
}

/** DELETE: the sender deletes a message, within 2 minutes of sending it. Everyone sees a placeholder. */
export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const profile = await requireProfile()
    const { id, messageId } = await parseIds(params)
    await deleteChatMessage(profile, id, messageId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
