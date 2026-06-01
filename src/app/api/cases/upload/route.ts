import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@/src/lib/supabase/server';

export async function POST(req: NextRequest) {
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
    const fileName = searchParams.get('fileName');
    const adminClientId = searchParams.get('clientId'); // Optional: sent by admin

    if (!fileName) {
      return NextResponse.json({ error: 'File Name is required' }, { status: 400 });
    }

    // 1. File size verification (Max 2GB)
    const contentLength = Number(req.headers.get('content-length') || 0);
    const maxLimit = 2 * 1024 * 1024 * 1024; // 2GB
    if (contentLength > maxLimit) {
      return NextResponse.json({ error: 'File size exceeds the 2GB limit' }, { status: 400 });
    }

    // 2. File extension verification
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const allowedExtensions = [
      '.png', '.jpg', '.jpeg',
      '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg',
      '.pdf',
      '.zip',
      '.dme',
      '.doc', '.docx',
      '.txt',
      '.html', '.htm'
    ];
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json({ error: 'Unsupported file type. Allowed: PNG, JPG, JPEG, MP4/video, PDF, ZIP, DME, DOC, DOCX, TXT, HTML' }, { status: 400 });
    }

    let clientId: string | undefined;

    if (isValidRoleForType('admin_portal', profile.role)) {
      clientId = adminClientId || profile.id; // Fallback to admin if not provided
    } else if (profile.role === 'client') {
      clientId = profile.id;
    } else if (profile.role === 'subuser') {
      const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
      if (!subUserRecord.length) {
        return NextResponse.json({ error: 'Subuser parent client not found' }, { status: 400 });
      }
      clientId = subUserRecord[0].clientId;
    }

    if (!clientId) {
      return NextResponse.json({ error: 'Failed to determine Client ID' }, { status: 400 });
    }

    // Fetch client profile to get lab name for folder structure
    const clientProfile = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1).then(res => res[0]);
    const labName = clientProfile?.labName || 'UnknownLab';

    // Directory structure: case_data / ClientName
    const dirPath = join(process.cwd(), 'case_data', labName);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    const filePath = join(dirPath, fileName);
    const writer = createWriteStream(filePath);

    const reader = req.body?.getReader();
    let totalBytesWritten = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value);
        totalBytesWritten += value.length;
      }
    }
    writer.end();

    // Local secure download URL
    const fileUrl = `/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`;

    return NextResponse.json({
      success: true,
      fileUrl,
      fileName,
      fileSize: totalBytesWritten,
      fileType: req.headers.get('content-type') || 'application/octet-stream',
      storagePath: `${labName}/${fileName}`,
    });
  } catch (error: any) {
    console.error('Immediate local upload route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
