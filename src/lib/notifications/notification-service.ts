import { db } from '@/src/db';
import { notifications, notificationPreferences } from '@/src/db/schema/notification';
import { profiles } from '@/src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { queueEmail } from '@/src/lib/queue/jobs';
import { NotificationEventPayload, NotificationType } from './notification-events';

export class NotificationService {
  /**
   * Safe preference loader with automatic transactional creation.
   * If a preference record does not exist for the user, it safely creates one
   * with all defaults enabled.
   */
  static async getPreferences(userId: string) {
    // 1. Fetch preferences
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (prefs) {
      return prefs;
    }

    // 2. Transactional fallback insertion if not found (default true for all settings)
    try {
      const [newPrefs] = await db
        .insert(notificationPreferences)
        .values({
          userId,
          emailEnabled: true,
          inAppEnabled: true,
          caseAssignedEmail: true,
          caseAssignedInApp: true,
          caseFeedbackEmail: true,
          caseFeedbackInApp: true,
          caseApprovedEmail: true,
          caseApprovedInApp: true,
          caseRejectedEmail: true,
          caseRejectedInApp: true,
          caseHoldEmail: true,
          caseHoldInApp: true,
          caseCancelEmail: true,
          caseCancelInApp: true,
          caseReminderEmail: true,
          caseReminderInApp: true,
          chatMessageEmail: true,
          chatMessageInApp: true,
        })
        .returning();
      return newPrefs;
    } catch (error) {
      // Handle race conditions where another thread inserted concurrently
      const [existingPrefs] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);
      if (existingPrefs) return existingPrefs;
      throw error;
    }
  }

  /**
   * Dispatches the notification event standard payload.
   * It performs payload validation, resolves target user preferences,
   * routes to the active channels, and handles failures elegantly.
   */
  static async dispatch(payload: NotificationEventPayload): Promise<{ success: boolean; channels: string[] }> {
    console.log(`[NotificationService] Emitting event: ${payload.type} from ${payload.actorUserId} to ${payload.targetUserId}`);

    // 1. Payload validation
    if (!payload.type || !payload.actorUserId || !payload.targetUserId || !payload.title || !payload.message) {
      console.error('[NotificationService] Invalid payload parameters:', payload);
      throw new Error('Invalid notification payload');
    }

    const channels: string[] = [];

    try {
      // 2. Resolve target user profile (get email)
      const [targetProfile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, payload.targetUserId))
        .limit(1);

      if (!targetProfile) {
        console.warn(`[NotificationService] Target user profile ${payload.targetUserId} not found. Skipping.`);
        return { success: false, channels };
      }

      // 3. Resolve preferences (loads defaults if missing)
      const prefs = await this.getPreferences(payload.targetUserId);

      // Determine channel switches
      const isEmailEnabled = prefs.emailEnabled && this.isEventEnabledForEmail(payload.type, prefs);
      const isInAppEnabled = prefs.inAppEnabled && this.isEventEnabledForInApp(payload.type, prefs);

      console.log(`[NotificationService] Preference evaluation: email=${isEmailEnabled}, inApp=${isInAppEnabled}`);

      // 4. In-App delivery (write database row)
      if (isInAppEnabled) {
        await db.insert(notifications).values({
          userId: payload.targetUserId,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          link: payload.link || null,
          metadata: payload.metadata || null,
          read: false,
          dismissed: false,
        });
        channels.push('in-app');
        console.log(`[NotificationService] In-app notification created for ${payload.targetUserId}`);
      }

      // 5. Email delivery (enqueue in BullMQ)
      if (isEmailEnabled && targetProfile.email) {
        try {
          await queueEmail({
            to: targetProfile.email,
            subject: payload.title,
            type: 'notification',
            html: this.renderEmailHtml(payload.title, payload.message, payload.link),
          });
          channels.push('email');
          console.log(`[NotificationService] Email enqueued successfully to ${targetProfile.email}`);
        } catch (emailErr) {
          console.error(`[NotificationService] Email delivery failure enqueuing for ${targetProfile.email}:`, emailErr);
          // Failures of email sending must NOT break business logic flow, so we catch and log
        }
      }

      return { success: true, channels };
    } catch (err) {
      console.error(`[NotificationService] Failed to dispatch notification event:`, err);
      throw err;
    }
  }

  // Check specific event switches for email
  private static isEventEnabledForEmail(type: string, prefs: any): boolean {
    switch (type) {
      case NotificationType.CASE_ASSIGNED: return prefs.caseAssignedEmail;
      case NotificationType.CASE_FEEDBACK: return prefs.caseFeedbackEmail;
      case NotificationType.CASE_APPROVED: return prefs.caseApprovedEmail;
      case NotificationType.CASE_REJECTED: return prefs.caseRejectedEmail;
      case NotificationType.CASE_HOLD: return prefs.caseHoldEmail;
      case NotificationType.CASE_CANCEL: return prefs.caseCancelEmail;
      case NotificationType.CASE_REMINDER: return prefs.caseReminderEmail;
      case NotificationType.CHAT_MESSAGE: return prefs.chatMessageEmail;
      default: return true;
    }
  }

  // Check specific event switches for in-app
  private static isEventEnabledForInApp(type: string, prefs: any): boolean {
    switch (type) {
      case NotificationType.CASE_ASSIGNED: return prefs.caseAssignedInApp;
      case NotificationType.CASE_FEEDBACK: return prefs.caseFeedbackInApp;
      case NotificationType.CASE_APPROVED: return prefs.caseApprovedInApp;
      case NotificationType.CASE_REJECTED: return prefs.caseRejectedInApp;
      case NotificationType.CASE_HOLD: return prefs.caseHoldInApp;
      case NotificationType.CASE_CANCEL: return prefs.caseCancelInApp;
      case NotificationType.CASE_REMINDER: return prefs.caseReminderInApp;
      case NotificationType.CHAT_MESSAGE: return prefs.chatMessageInApp;
      default: return true;
    }
  }

  // HTML Template helper for standard emails
  private static renderEmailHtml(title: string, message: string, link?: string): string {
    const actionButton = link
      ? `<div style="margin-top: 24px;">
           <a href="${link}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">View Details</a>
         </div>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; padding: 40px; margin: 0;">
        <div style="max-width: 600px; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); margin: 0 auto; border: 1px solid #e4e4e7;">
          <div style="background-color: #0f172a; padding: 24px; text-align: center; border-bottom: 2px solid #059669;">
            <span style="font-size: 20px; font-weight: bold; color: white; letter-spacing: 0.5px;">IconicConnect</span>
          </div>
          <div style="padding: 32px; color: #1f2937;">
            <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">${title}</h2>
            <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">${message}</p>
            ${actionButton}
          </div>
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">This is an automated email from IconicConnect.</p>
            <p style="margin: 4px 0 0 0;">You can customize your notification preferences inside your account profile dashboard.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
