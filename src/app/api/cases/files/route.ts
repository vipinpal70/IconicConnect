import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '@/src/lib/r2';

function objectKey(labName: string, fileName: string) {
  return `${labName}/${fileName}`;
}

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

    const key = objectKey(labName, fileName);

    let object;
    try {
      object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      throw err;
    }

    if (!object.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Detect content type for proper browser rendering
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    const contentType = isHtml ? 'text/html; charset=utf-8' : 'application/octet-stream';
    const disposition = isHtml ? `inline; filename="${encodeURIComponent(fileName)}"` : `attachment; filename="${encodeURIComponent(fileName)}"`;

    // Stream the R2 object body straight through to the client
    const webStream = (object.Body as any).transformToWebStream() as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
    };
    if (typeof object.ContentLength === 'number') {
      headers['Content-Length'] = object.ContentLength.toString();
    }

    // Allow HTML files to be embedded in iframes
    if (isHtml) {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['Content-Security-Policy'] = "frame-ancestors 'self'";
    }

    return new Response(webStream, { headers });
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

    const key = objectKey(labName, fileName);

    // DeleteObject is idempotent on R2 — it succeeds whether or not the key exists.
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return NextResponse.json({ success: true, message: 'File deleted successfully' });
  } catch (error: any) {
    console.error('File delete route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
