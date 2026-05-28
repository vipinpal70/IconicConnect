import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { logActivity } from '@/src/lib/activity-log'
import { notifyCaseStatusChanged } from '@/src/lib/notifications/notification-dispatcher'
import { CASE_APPROVAL_CHECKLIST, normalizeCaseApprovalChecklist } from '@/src/lib/case-approval'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

async function getAuthenticatedProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  return { profile }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await getAuthenticatedProfile()
    if ('error' in auth) return auth.error

    const { profile } = auth
    if (!['admin', 'qc'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Only admin and QC users can view approval checklists' }, { status: 403 })
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (profile.role === 'qc' && caseRecord.qcId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: QC can only view approval checklists for assigned cases' }, { status: 403 })
    }

    return NextResponse.json({ data: caseRecord.approvalChecklist ?? [] })
  } catch (error) {
    console.error('Get case approval checklist error:', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await getAuthenticatedProfile()
    if ('error' in auth) return auth.error

    const { profile } = auth
    if (!['admin', 'qc'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Only admin and QC users can approve cases' }, { status: 403 })
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (profile.role === 'qc' && caseRecord.qcId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: QC can only approve cases assigned to them' }, { status: 403 })
    }

    if (caseRecord.status !== 'internal_qc') {
      return NextResponse.json({ error: 'Forbidden: Case must be in Internal QC before approval' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const normalizedChecklist = normalizeCaseApprovalChecklist(body.checkedItems ?? body.approvalChecklist)

    if (normalizedChecklist.length !== CASE_APPROVAL_CHECKLIST.length) {
      return NextResponse.json({ error: 'Please complete all QC checklist items before approving.' }, { status: 400 })
    }

    const [updatedCase] = await db
      .update(cases)
      .set({
        approvalChecklist: normalizedChecklist,
        status: 'submitted_to_client',
      })
      .where(eq(cases.id, id))
      .returning()

    if (!updatedCase) {
      return NextResponse.json({ error: 'Failed to approve case' }, { status: 500 })
    }

    const caseUrl = `/cases/${id}`
    const caseNumber = updatedCase.caseNumber ?? caseRecord.caseNumber ?? ''

    await notifyCaseStatusChanged({
      actorUserId: profile.id,
      targetUserId: caseRecord.clientId,
      caseId: id,
      caseNumber,
      status: 'submitted_to_client',
    }).catch((err) => console.error('[ApprovalChecklistNotification] Failed to dispatch approval notification:', err))

    await logActivity({
      actor: profile,
      action: 'case.updated',
      caseId: id,
      details: {
        caseNumber,
        before: {
          status: caseRecord.status,
          approvalChecklist: caseRecord.approvalChecklist ?? [],
        },
        changes: {
          status: 'submitted_to_client',
          approvalChecklist: normalizedChecklist,
          approvalChecklistComplete: true,
          caseUrl,
        },
      },
    })

    return NextResponse.json({ data: updatedCase })
  } catch (error) {
    console.error('Approve case error:', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
