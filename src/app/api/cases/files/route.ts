import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { createReadStream, existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

export async function GET(req: NextRequest) {
  try {
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

    const { searchParams } = new URL(req.url);
    const labName = searchParams.get('labName');
    const fileName = searchParams.get('fileName');

    if (!labName || !fileName) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Role-based security check
    let allowed = false;

    if (
      isValidRoleForType('admin_portal', profile.role) ||
      profile.role === 'qc' ||
      profile.role === 'designer' ||
      profile.role === 'account_manager'
    ) {
      allowed = true;
    } else if (profile.role === 'client') {
      // Allow only if labName matches
      if (profile.labName === labName) {
        allowed = true;
      }
    } else if (profile.role === 'subuser') {
      const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
      if (subUserRecord.length) {
        const parentClient = await db.select().from(profiles).where(eq(profiles.id, subUserRecord[0].clientId)).limit(1).then(res => res[0]);
        if (parentClient?.labName === labName) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filePath = join(process.cwd(), 'case_data', labName, fileName);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stats = statSync(filePath);
    const fileStream = createReadStream(filePath);

    // Convert fileReadStream to a Web readable stream so Next.js can send it
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        fileStream.destroy();
      }
    });

    return new Response(webStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size.toString(),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error: any) {
    console.error('File serve route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
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

    const { searchParams } = new URL(req.url);
    const labName = searchParams.get('labName');
    const fileName = searchParams.get('fileName');

    if (!labName || !fileName) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Role-based security check
    let allowed = false;

    if (
      isValidRoleForType('admin_portal', profile.role) ||
      profile.role === 'qc' ||
      profile.role === 'designer' ||
      profile.role === 'account_manager'
    ) {
      allowed = true;
    } else if (profile.role === 'client') {
      if (profile.labName === labName) {
        allowed = true;
      }
    } else if (profile.role === 'subuser') {
      const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
      if (subUserRecord.length) {
        const parentClient = await db.select().from(profiles).where(eq(profiles.id, subUserRecord[0].clientId)).limit(1).then(res => res[0]);
        if (parentClient?.labName === labName) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filePath = join(process.cwd(), 'case_data', labName, fileName);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return NextResponse.json({ success: true, message: 'File deleted successfully' });
    } else {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
  } catch (error: any) {
    console.error('File delete route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
