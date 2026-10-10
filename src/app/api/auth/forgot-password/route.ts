import { logAuthEvent } from '@/src/lib/auth/audit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { createResetToken, findUserIdByEmail } from '@/src/lib/auth/auth-service';
import { escapeHtml } from '@/src/lib/security/html';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const GENERIC_OK = { success: true, message: 'If an account exists for that email, a password reset link has been sent.' };

    if (!email || email.length > 254) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // 1. Look the account up (one indexed read). Identical response whether or not it exists — no enumeration.
    const userId = await findUserIdByEmail(email);
    // Recorded for both outcomes (unknown emails = probing) but the response below is identical either way.
    logAuthEvent({ event: 'pw_reset_requested', userId, email, headers: req.headers, details: { known: Boolean(userId) } });
    if (!userId) return NextResponse.json(GENERIC_OK);
    const [profile] = await db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, userId)).limit(1);

    // 2. Single-use token, hashed at rest in Redis, 1 h.
    const origin = process.env.NEXT_PUBLIC_APP_URL!;
    const customResetUrl = `${origin}/auth/reset-password?token=${encodeURIComponent(await createResetToken(userId))}`;

    // 3. Queue the custom email via our Resend Worker. This is the entire
    // point of the request (unlike an admin-initiated password reset, there
    // is no already-succeeded primary action to protect) — so a queue
    // failure is reported honestly as an error rather than a false "sent",
    // with a specific message instead of the generic catch-all below.
    const { queueEmailSafely } = await import('@/src/lib/queue/jobs');

    const { queued, error: emailError } = await queueEmailSafely({
      to: email,
      subject: 'Reset your IconicConnect Password',
      type: 'reset-password', // using specific queue type
      html: `
        <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
          <h2>Reset Password</h2>
          <p>Hello ${escapeHtml(profile?.fullName || 'there')},</p>
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

    if (!queued) {
      console.error('Failed to queue password reset email:', emailError);
      return NextResponse.json({ error: 'Failed to send the reset email — please try again in a moment.' }, { status: 502 });
    }

    return NextResponse.json(GENERIC_OK);
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
