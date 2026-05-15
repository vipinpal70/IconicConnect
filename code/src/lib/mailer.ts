/**
 * Placeholder for email service.
 * In a real application, you would use Resend, SendGrid, or Nodemailer here.
 */

export async function sendEmail({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}) {
  console.log(`[MAILER] Sending email to: ${to}`);
  console.log(`[MAILER] Subject: ${subject}`);
  console.log(`[MAILER] Body: ${body}`);
  
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  return { success: true };
}

export async function sendCredentialsEmail({
  email,
  password,
  name,
}: {
  email: string;
  password: string;
  name: string;
}) {
  const subject = 'Your IconicConnect Credentials';
  const body = `
    Hi ${name},

    Your account has been created/updated on IconicConnect.
    
    Login details:
    Email: ${email}
    Password: ${password}

    You can login at: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/sign-in

    Regards,
    IconicConnect Team
  `;

  return sendEmail({ to: email, subject, body });
}
