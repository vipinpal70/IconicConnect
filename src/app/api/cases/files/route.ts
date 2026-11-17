import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { files } from '@/src/db/schema/files';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET } from '@/src/lib/r2';
import { getProfileLabName } from '@/src/lib/profile-utils';
import { displayFileName } from '@/src/lib/case-file-keys';

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

    if (!labName || !fileName || labName.length > 300 || fileName.length > 600 || /[\u0000-\u001f]/.test(labName + fileName)) {
      return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
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
      const clientLab = getProfileLabName(profile);
      if (
        profile.labName === labName ||
        clientLab === labName
      ) {
        allowed = true;
      }
    } else if (profile.role === 'subuser') {
      const subUserRecord = await Promise.resolve(profile.clientId ? [{ clientId: profile.clientId }] : []);
      if (subUserRecord.length) {
        const parentClient = await db.select().from(profiles).where(eq(profiles.id, subUserRecord[0].clientId)).limit(1).then(res => res[0]);
        if (parentClient) {
          const parentLab = getProfileLabName(parentClient);
          if (
            parentClient.labName === labName ||
            parentLab === labName
          ) {
            allowed = true;
          }
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const key = objectKey(labName, fileName);

    // Optional direct-to-R2 delivery (R2_DIRECT_DOWNLOADS=true): after the authorization above, redirect to a
    // short-lived presigned URL so the bytes go Cloudflare → browser instead of R2 → this server → nginx →
    // browser. Forced download + octet-stream keep the untrusted-content guarantees (and R2 is a different
    // origin from the app, so nothing can touch our cookies). The bucket needs a CORS rule for this origin
    // if any page fetch()es these URLs.
    // Off by default; not exercised in tests.
    // Case-scoped files live in sub-folders (case-outputs/<case>/<upload>/<name>); downloads use only the name
    const downloadName = encodeURIComponent(displayFileName(fileName));
    const ext = fileName.lastIndexOf('.') >= 0 ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : '';
    const isHtml = ext === '.html' || ext === '.htm';

    // HTML previews (exocad webview, 3Shape viewers) are always served from R2's own origin via a short-lived
    // presigned URL. These viewers need a real origin (localStorage etc. throw under an opaque-origin sandbox,
    // which crashes exocad during initialize), and the R2 origin never holds this app's cookies, so the page
    // still can't read the session or call our API as the viewer.
    if (isHtml) {
      const url = await getSignedUrl(
        r2,
        new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          ResponseContentType: 'text/html; charset=utf-8',
          ResponseContentDisposition: `inline; filename="${downloadName}"`,
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn: 600 },
      );
      return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, no-store' } });
    }

    {
      if (process.env.R2_DIRECT_DOWNLOADS === 'true') {
        const url = await getSignedUrl(
          r2,
          new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            ResponseContentType: 'application/octet-stream',
            ResponseContentDisposition: `attachment; filename="${downloadName}"`,
          }),
          { expiresIn: 300 },
        );
        return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, no-store' } });
      }
    }

    let object;
    try {
      object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        await db.update(files)
          .set({ status: 'purged', purgedAt: new Date() })
          .where(eq(files.r2Key, key));
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      throw err;
    }

    if (!object.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // User-uploaded content is untrusted. It must never run with this app's origin (session cookies,
    // same-origin APIs), so everything proxied here is a forced download with nosniff and a CSP sandbox
    // (HTML never reaches this point; it is redirected to R2 above).
    const safeName = downloadName;

    // Stream the R2 object body straight through to the client
    const webStream = (object.Body as any).transformToWebStream() as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (typeof object.ContentLength === 'number') {
      headers['Content-Length'] = object.ContentLength.toString();
    }

    headers['Content-Security-Policy'] = "default-src 'none'; sandbox";

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

    if (!labName || !fileName || labName.length > 300 || fileName.length > 600 || /[\u0000-\u001f]/.test(labName + fileName)) {
      return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    // Role-based security check
    let allowed = false;

    if (
      isValidRoleForType('admin_portal', profile.role) ||
      profile.role === 'qc' ||
      profile.role === 'designer'
    ) {
      allowed = true;
    } else if (profile.role === 'client') {
      const clientLab = getProfileLabName(profile);
      if (
        profile.labName === labName ||
        clientLab === labName
      ) {
        allowed = true;
      }
    } else if (profile.role === 'subuser') {
      const subUserRecord = await Promise.resolve(profile.clientId ? [{ clientId: profile.clientId }] : []);
      if (subUserRecord.length) {
        const parentClient = await db.select().from(profiles).where(eq(profiles.id, subUserRecord[0].clientId)).limit(1).then(res => res[0]);
        if (parentClient) {
          const parentLab = getProfileLabName(parentClient);
          if (
            parentClient.labName === labName ||
            parentLab === labName
          ) {
            allowed = true;
          }
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const key = objectKey(labName, fileName);

    // This endpoint only discards an upload the user just made and then removed (before saving the case).
    // Anything a case, chat message or other record still points at must never be deleted here: older
    // uploads share flat `<lab>/<name>` keys, so a same-named file of another case would otherwise vanish.
    // Records are removed through their own endpoints; the orphan sweep reclaims their objects.
    const referenced = await db.select({ id: files.id }).from(files).where(eq(files.r2Key, key)).limit(1);
    if (referenced.length > 0) {
      return NextResponse.json({ error: 'File is in use and cannot be deleted here' }, { status: 409 });
    }

    // DeleteObject is idempotent on R2 — it succeeds whether or not the key exists.
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return NextResponse.json({ success: true, message: 'File deleted successfully' });
  } catch (error: any) {
    console.error('File delete route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
