import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, CaseTimelineEvent, EDITABLE_STATUSES } from '@/src/db/schema/case';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { logActivity } from '@/src/lib/activity-log';

type CaseUpdateData = {
  caseNumber?: string
  dueDate?: Date
  category?: string
  subTypeData?: unknown
  status?:
  | 'scan_received'
  | 'allocated_to_designer'
  | 'scan_verified'
  | 'scan_not_verified'
  | 'in_progress'
  | 'internal_qc'
  | 'submitted_to_client'
  | 'on_hold'
  | 'client_feedback'
  | 'approved'
  | 'delivered'
  designerId?: string | null
  qcId?: string | null
  accountManagerId?: string | null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Role checks for GET
    if (profile.role === 'subuser' && caseRecord.subuserId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view your own cases' }, { status: 403 });
    } else if (profile.role === 'client' && caseRecord.clientId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view cases from your lab' }, { status: 403 });
    }

    let designerName: string | null = null;
    if (caseRecord.designerId) {
      const [designerProfile] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.designerId)).limit(1);
      designerName = designerProfile?.fullName || null;
    }

    let qcName: string | null = null;
    if (caseRecord.qcId) {
      const [qcProfile] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.qcId)).limit(1);
      qcName = qcProfile?.fullName || null;
    }

    let accountManagerName: string | null = null;
    if (caseRecord.accountManagerId) {
      const [amProfile] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.accountManagerId)).limit(1);
      accountManagerName = amProfile?.fullName || null;
    }

    return NextResponse.json({
      data: {
        ...caseRecord,
        designerName,
        qcName,
        accountManagerName,
      }
    });
  } catch (error: unknown) {
    console.error('Get case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const body = await req.json();
    const updateData: CaseUpdateData = {};

    // Validate and build updates based on role
    if (profile.role === 'client' || profile.role === 'subuser') {
      if (profile.role === 'client' && caseRecord.clientId !== profile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only update cases from your lab' }, { status: 403 });
      }
      if (profile.role === 'subuser') {
        const [subuserRecord] = await db.select().from(subUsers).where(and(eq(subUsers.profileId, profile.id), eq(subUsers.clientId, caseRecord.clientId))).limit(1);
        if (!subuserRecord) {
          return NextResponse.json({ error: 'Forbidden: You do not have access to this client\'s cases' }, { status: 403 });
        }
      }

      if (body.status) {
        const current = caseRecord.status;
        const target = body.status;

        // 1. Hold before In Design
        if (target === 'on_hold') {
          const allowedForHold = ['scan_received', 'scan_not_verified', 'scan_verified'];
          if (!allowedForHold.includes(current)) {
            return NextResponse.json({ error: 'Forbidden: Cannot place case on hold after design has started' }, { status: 400 });
          }
        }
        // 2. Resume from hold
        else if (target === 'scan_received' && current === 'on_hold') {
          // Allowed to resume
        }
        // 3. Cancel case (Cancelled) before In Validation
        else if (target === 'cancelled') {
          if (current !== 'scan_received' && current !== 'on_hold') {
            return NextResponse.json({ error: 'Forbidden: Cannot cancel case after validation has started' }, { status: 400 });
          }
          if (current === 'on_hold') {
            const hasBeenValidated = (caseRecord.timeline || []).some(
              (act: CaseTimelineEvent) => act.label === "Scan validated" || act.label === "Scan rejected" || act.label.includes("QC") || act.label.includes("designer")
            );
            if (hasBeenValidated) {
              return NextResponse.json({ error: 'Forbidden: Cannot cancel case after validation has started' }, { status: 400 });
            }
          }
        }
        // 4. Approve case (approved) during Client Review
        else if (target === 'approved') {
          if (current !== 'submitted_to_client') {
            return NextResponse.json({ error: 'Forbidden: Cannot approve case unless it is in Client Review status' }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: `Forbidden: Client/Subusers cannot transition status from ${current} to ${target}` }, { status: 403 });
        }

        updateData.status = target;
      }

      // Allow editing details only if before work starts
      if (body.caseNumber || body.dueDate || body.category || body.subTypeData) {
        if (!EDITABLE_STATUSES.includes(caseRecord.status as typeof EDITABLE_STATUSES[number])) {
          return NextResponse.json({ error: 'Forbidden: Cannot edit case details after work has started' }, { status: 403 });
        }
        if (body.caseNumber) updateData.caseNumber = body.caseNumber;
        if (body.dueDate) updateData.dueDate = new Date(body.dueDate);
        if (body.category) updateData.category = body.category;
        if (body.subTypeData) updateData.subTypeData = body.subTypeData;
      }
    } else if (isValidRoleForType('admin_portal', profile.role)) {
      if (body.caseNumber) updateData.caseNumber = body.caseNumber;
      if (body.dueDate) updateData.dueDate = new Date(body.dueDate);
      if (body.category) updateData.category = body.category;
      if (body.subTypeData) updateData.subTypeData = body.subTypeData;
      if (body.designerId !== undefined) updateData.designerId = body.designerId;
      if (body.qcId !== undefined) updateData.qcId = body.qcId;
      if (body.accountManagerId !== undefined) updateData.accountManagerId = body.accountManagerId;

      if (body.status) {
        const current = caseRecord.status;
        const target = body.status;

        if (profile.role === 'admin') {
          updateData.status = target;
        } else if (profile.role === 'designer') {
          if (caseRecord.designerId !== profile.id) {
            return NextResponse.json({ error: 'Forbidden: You can only update cases assigned to you' }, { status: 403 });
          }
          if (target === 'in_progress' && current === 'allocated_to_designer') {
            updateData.status = target;
          } else if (target === 'internal_qc' && current === 'in_progress') {
            updateData.status = target;
          } else {
            return NextResponse.json({ error: `Forbidden: Designers cannot transition status from ${current} to ${target}` }, { status: 403 });
          }
        } else if (profile.role === 'qc') {
          if (current !== 'internal_qc') {
            return NextResponse.json({ error: 'Forbidden: QC Leads can only perform actions on cases in Internal QC stage' }, { status: 403 });
          }
          const qcAllowed = ['submitted_to_client', 'in_progress', 'on_hold'];
          if (qcAllowed.includes(target)) {
            updateData.status = target;
          } else {
            return NextResponse.json({ error: `Forbidden: QC Leads cannot transition status from ${current} to ${target}` }, { status: 403 });
          }
        } else {
          return NextResponse.json({ error: 'Forbidden: Unauthorized internal role action' }, { status: 403 });
        }
      }
    } else {
      return NextResponse.json({ error: 'Forbidden: Unauthorized role' }, { status: 403 });
    }

    const updatedCase = await db.update(cases).set(updateData).where(eq(cases.id, id)).returning();

    await logActivity({
      actor: profile,
      action: 'case.updated',
      caseId: id,
      details: {
        caseNumber: caseRecord.caseNumber,
        before: {
          caseNumber: caseRecord.caseNumber,
          dueDate: caseRecord.dueDate?.toISOString() ?? null,
          category: caseRecord.category,
          subTypeData: caseRecord.subTypeData,
          status: caseRecord.status,
          designerId: caseRecord.designerId,
          qcId: caseRecord.qcId,
          accountManagerId: caseRecord.accountManagerId,
        },
        changes: {
          caseNumber: updateData.caseNumber,
          dueDate: updateData.dueDate?.toISOString?.() ?? null,
          category: updateData.category,
          subTypeData: updateData.subTypeData,
          status: updateData.status,
          designerId: updateData.designerId,
          qcId: updateData.qcId,
          accountManagerId: updateData.accountManagerId,
        },
      },
    });

    return NextResponse.json({ data: updatedCase[0] });
  } catch (error: unknown) {
    console.error('Update case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const caseRecord = await db.select().from(cases).where(eq(cases.id, id)).limit(1).then(res => res[0]);

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Role checks for DELETE
    if (profile.role === 'subuser') {
      return NextResponse.json({ error: 'Forbidden: Subusers cannot delete cases' }, { status: 403 });
    }

    if (profile.role === 'client') {
      if (caseRecord.clientId !== profile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only delete cases from your lab' }, { status: 403 });
      }
      if (!EDITABLE_STATUSES.includes(caseRecord.status as typeof EDITABLE_STATUSES[number])) {
        return NextResponse.json({ error: 'Forbidden: Cannot delete case once work has started' }, { status: 403 });
      }
    }

    await logActivity({
      actor: profile,
      action: 'case.deleted',
      caseId: id,
      details: {
        caseNumber: caseRecord.caseNumber,
        category: caseRecord.category,
        clientId: caseRecord.clientId,
        subuserId: caseRecord.subuserId,
        status: caseRecord.status,
      },
    });

    await db.delete(cases).where(eq(cases.id, id));

    return NextResponse.json({ message: 'Case deleted successfully' });
  } catch (error: unknown) {
    console.error('Delete case error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
