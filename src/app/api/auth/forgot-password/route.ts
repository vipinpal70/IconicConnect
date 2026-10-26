import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { authCredentials, authRecoveryTokens } from '@/src/db/schema';
import { eq, ilike } from 'drizzle-orm';
import { escapeHtml } from '@/src/lib/security/html';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const GENERIC_OK = { success: true, message: 'If an account exists for that email, a password reset link has been sent.' };

    if (!email || email.length > 254) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // 1. Check if email exists in profiles table
    const results = await db.select().from(profiles).where(ilike(profiles.email, email)).limit(1);
    const profile = results[0];
    const [credential] = await db.select({
      userId: authCredentials.userId,
    }).from(authCredentials).where(ilike(authCredentials.email, email)).limit(1);

    if (!profile || !credential) {
      // Identical response whether or not the account exists — no email enumeration.
      return NextResponse.json(GENERIC_OK);
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.delete(authRecoveryTokens).where(eq(authRecoveryTokens.userId, credential.userId));
    await db.insert(authRecoveryTokens).values({
      tokenHash,
      userId: credential.userId,
      expiresAt,
    });
    const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const customResetUrl = `${origin}/auth/verify?token=${encodeURIComponent(token)}&next=/auth/reset-password`;

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
          <p>Hello ${escapeHtml(profile.fullName || 'there')},</p>
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
      await db.delete(authRecoveryTokens).where(eq(authRecoveryTokens.tokenHash, tokenHash));
      return NextResponse.json({ error: 'Failed to send the reset email — please try again in a moment.' }, { status: 502 });
    }

    return NextResponse.json(GENERIC_OK);
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
