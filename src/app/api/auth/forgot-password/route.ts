import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, ilike } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // 1. Check if email exists in profiles table
    const results = await db.select().from(profiles).where(ilike(profiles.email, email)).limit(1);
    const profile = results[0];

    if (!profile) {
      // For security, you might want to return success even if email doesn't exist
      // to prevent email enumeration. But user specifically asked for this check.
      return NextResponse.json({ error: 'User with this email does not exist' }, { status: 404 });
    }

    // 2. Generate a recovery link using the Service Role Key
    // This allows us to bypass Supabase's built-in email templates and use our own robust queue
    if (typeof globalThis.WebSocket === 'undefined') {
      globalThis.WebSocket = class {} as any;
    }
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const origin = process.env.NEXT_PUBLIC_APP_URL!;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${origin}/auth/reset-password`
      }
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('Error generating link:', linkError);
      return NextResponse.json({ error: 'Failed to generate reset link' }, { status: 400 });
    }

    const tokenHash = linkData.properties.hashed_token;
    const customResetUrl = `${origin}/auth/verify?token_hash=${tokenHash}&type=recovery&next=/auth/reset-password`;

    // 3. Queue the custom email via our Resend Worker
    const { queueEmail } = await import('@/src/lib/queue/jobs');
    
    await queueEmail({
      to: email,
      subject: 'Reset your IconicConnect Password',
      type: 'reset-password', // using specific queue type
      html: `
        <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
          <h2>Reset Password</h2>
          <p>Hello ${profile.fullName || 'there'},</p>
          <p>We received a request to reset the password for your IconicConnect account. If you didn't make this request, you can safely ignore this email.</p>
          <br/>
          <a href="${customResetUrl}" style="display: inline-block; background-color: #00786f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
          <br/><br/>
          <p style="color: #666; font-size: 14px;">If the button above does not work, copy and paste this URL into your browser:</p>
          <p style="color: #666; font-size: 14px; word-break: break-all;">${customResetUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px;">This link will expire in 1 hour.</p>
        </div>
      `
    });

    return NextResponse.json({ success: true, message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
