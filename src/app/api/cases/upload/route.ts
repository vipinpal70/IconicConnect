import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createClient } from '@/src/lib/supabase/server';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

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

    // Chunking parameters
    const chunkIndexStr = searchParams.get('chunkIndex');
    const totalChunksStr = searchParams.get('totalChunks');
    const uploadId = searchParams.get('uploadId');

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
    let labName = 'UnknownLab';

    if (isValidRoleForType('admin_portal', profile.role)) {
      clientId = adminClientId || profile.id; // Fallback to admin if not provided
    } else if (profile.role === 'client') {
      clientId = profile.id;
      labName = profile.labName || 'UnknownLab';
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

    // Optimize DB query: fetch client profile only if we don't already have it
    if (profile.role !== 'client') {
      if (clientId === profile.id) {
        labName = profile.labName || 'UnknownLab';
      } else {
        const clientProfileResult = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1);
        const clientProfile = clientProfileResult[0];
        labName = clientProfile?.labName || 'UnknownLab';
      }
    }

    if (!req.body) {
      return NextResponse.json({ error: 'No file data received' }, { status: 400 });
    }

    const isChunked = chunkIndexStr !== null && totalChunksStr !== null && uploadId !== null;

    if (isChunked) {
      const chunkIndex = parseInt(chunkIndexStr!, 10);
      const totalChunks = parseInt(totalChunksStr!, 10);

      // Temporary folder for storing chunks
      const tempChunksDir = join(process.cwd(), 'case_data', 'chunks', uploadId!);
      if (!existsSync(tempChunksDir)) {
        mkdirSync(tempChunksDir, { recursive: true });
      }

      const chunkPath = join(tempChunksDir, chunkIndex.toString());
      const chunkWriter = createWriteStream(chunkPath, { highWaterMark: 1024 * 1024 }); // 1MB writing buffer

      try {
        await pipeline(Readable.fromWeb(req.body as any), chunkWriter);
      } catch (err) {
        try {
          if (existsSync(chunkPath)) {
            unlinkSync(chunkPath);
          }
        } catch (cleanupErr) {
          console.error('Failed to delete incomplete chunk:', cleanupErr);
        }
        throw err;
      }

      // Check if all chunks exist
      const uploadedChunks = readdirSync(tempChunksDir);
      if (uploadedChunks.length === totalChunks) {
        // Double check all indices from 0 to totalChunks-1 exist
        const allChunksPresent = Array.from({ length: totalChunks }, (_, i) =>
          existsSync(join(tempChunksDir, i.toString()))
        ).every(Boolean);

        if (allChunksPresent) {
          // Reassemble chunks
          const dirPath = join(process.cwd(), 'case_data', labName);
          if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
          }

          const filePath = join(dirPath, fileName);
          const finalWriter = createWriteStream(filePath, { highWaterMark: 1024 * 1024 }); // 1MB buffer

          try {
            for (let i = 0; i < totalChunks; i++) {
              const currentChunkPath = join(tempChunksDir, i.toString());
              const chunkReader = createReadStream(currentChunkPath);

              for await (const chunk of chunkReader) {
                const canWrite = finalWriter.write(chunk);
                if (!canWrite) {
                  await new Promise<void>((resolve) => finalWriter.once('drain', resolve));
                }
              }
            }
            finalWriter.end();
            await new Promise<void>((resolve, reject) => {
              finalWriter.on('finish', resolve);
              finalWriter.on('error', reject);
            });

            // Cleanup chunk folder and files recursively
            if (existsSync(tempChunksDir)) {
              rmSync(tempChunksDir, { recursive: true, force: true });
            }
          } catch (mergeError) {
            finalWriter.end();
            if (existsSync(filePath)) {
              try {
                unlinkSync(filePath);
              } catch (cleanupErr) {
                console.error('Failed to clean up merged file on error:', cleanupErr);
              }
            }
            throw mergeError;
          }

          const stats = statSync(filePath);
          const totalBytesWritten = stats.size;

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
        }
      }

      // Chunk received successfully, but still waiting for other chunks
      return NextResponse.json({
        success: true,
        chunkReceived: chunkIndex
      });

    } else {
      // Legacy single-stream fallback upload (Optimized with highWaterMark write buffer)
      const dirPath = join(process.cwd(), 'case_data', labName);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filePath = join(dirPath, fileName);
      const writer = createWriteStream(filePath, { highWaterMark: 1024 * 1024 }); // 1MB write buffer

      try {
        // Use pipeline to handle stream backpressure, saving memory and avoiding process/GC stalling
        await pipeline(Readable.fromWeb(req.body as any), writer);
      } catch (err) {
        // Clean up partially written file if upload is aborted/failed
        try {
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }
        } catch (cleanupErr) {
          console.error('Failed to delete incomplete file:', cleanupErr);
        }
        throw err;
      }

      const stats = statSync(filePath);
      const totalBytesWritten = stats.size;

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
    }
  } catch (error: any) {
    console.error('Immediate local upload route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
