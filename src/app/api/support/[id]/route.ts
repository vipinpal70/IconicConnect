import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  void req
  void _ctx
  return NextResponse.json({ error: 'Support ticket status changes are managed by the support team' }, { status: 403 })
}
