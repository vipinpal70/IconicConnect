// Thin wrapper over the real Resend/BullMQ email pipeline
// (src/lib/queue/jobs.ts) — this file used to be an unwired placeholder that
// only console.logged and reported { success: true } regardless, so every
// caller believed an email had been sent when none ever was. Every other
// credentials email in the app already goes through queueEmailSafely; this
// makes sendCredentialsEmail do the same instead of being a second,
// non-functional path.
import { queueEmailSafely } from '@/src/lib/queue/jobs';

export async function sendEmail({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  const { queued, error } = await queueEmailSafely({
    to,
    subject,
    type: 'notification',
    html: `<pre style="font-family:inherit;white-space:pre-wrap;">${body}</pre>`,
  });
  return { success: queued, error };
}

export async function sendCredentialsEmail({
  email,
  password,
  name,
}: {
  email: string;
  password: string;
  name: string;
}): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const { queued, error } = await queueEmailSafely({
    to: email,
    subject: 'Your IconicConnect Credentials',
    type: 'credentials',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#065f46;margin-bottom:4px;">Your Account is Ready</h2>
        <p style="color:#111827;">Hi ${name},</p>
        <p style="color:#374151;">Your account has been created/updated on IconicConnect.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${email}</p>
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Please change your password after logging in.</p>
      </div>
    `,
  });
  return { success: queued, error };
}
