import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, EDITABLE_STATUSES } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
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

    return NextResponse.json({ data: caseRecord });
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

    // Role checks for PUT
    if (profile.role === 'subuser') {
      return NextResponse.json({ error: 'Forbidden: Subusers cannot update case details' }, { status: 403 });
    }
    
    if (profile.role === 'client') {
      if (caseRecord.clientId !== profile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only update cases from your lab' }, { status: 403 });
      }
      if (!EDITABLE_STATUSES.includes(caseRecord.status as typeof EDITABLE_STATUSES[number])) {
        return NextResponse.json({ error: 'Forbidden: Cannot update case once work has started' }, { status: 403 });
      }
    }

    const body = await req.json();
    
    const updateData: CaseUpdateData = {};
    if (body.caseNumber) updateData.caseNumber = body.caseNumber;
    if (body.dueDate) updateData.dueDate = new Date(body.dueDate);
    if (body.category) updateData.category = body.category;
    if (body.subTypeData) updateData.subTypeData = body.subTypeData;
    
    // Only admins can change status or assignees
    if (isValidRoleForType('admin_portal', profile.role)) {
       if (body.status) updateData.status = body.status;
       if (body.designerId !== undefined) updateData.designerId = body.designerId;
       if (body.qcId !== undefined) updateData.qcId = body.qcId;
       if (body.accountManagerId !== undefined) updateData.accountManagerId = body.accountManagerId;
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
