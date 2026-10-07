import { db } from '@/src/db';
import { notifications, notificationPreferences } from '@/src/db/schema/notification';
import { profiles } from '@/src/db/schema/profile';
import { eq, inArray } from 'drizzle-orm';
import { connection } from '@/src/lib/queue/client';
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
          caseCreatedEmail: true,
          caseCreatedInApp: true,
          offerCreatedEmail: true,
          offerCreatedInApp: true,
          tutorialCreatedEmail: true,
          tutorialCreatedInApp: true,
          supportTicketCreatedEmail: true,
          supportTicketCreatedInApp: true,
          supportTicketUpdatedEmail: true,
          supportTicketUpdatedInApp: true,
          supportCallbackEmail: true,
          supportCallbackInApp: true,
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
   * Dispatches one notification. Thin wrapper over dispatchMany so single and fan-out sends share one
   * code path (and one set of cache invalidations).
   */
  static async dispatch(payload: NotificationEventPayload): Promise<{ success: boolean; channels: string[] }> {
    if (!payload.type || !payload.actorUserId || !payload.targetUserId || !payload.title || !payload.message) {
      console.error('[NotificationService] Invalid payload parameters:', payload);
      throw new Error('Invalid notification payload');
    }
    const [result] = await this.dispatchMany([payload]);
    return result;
  }

  /**
   * Fan-out dispatch. Cost is a fixed 3 queries (profiles, preferences, one bulk insert) plus the email
   * enqueues, regardless of recipient count — the old per-recipient path ran ~4 queries each, concurrently,
   * which saturated the 3-connection pool whenever a case was submitted to many staff.
   * Recipients with no preference row are treated as all-enabled (the schema defaults) without writing one.
   */
  static async dispatchMany(payloads: NotificationEventPayload[]): Promise<{ success: boolean; channels: string[] }[]> {
    const valid = payloads.map((p) => Boolean(p.type && p.actorUserId && p.targetUserId && p.title && p.message));
    const items = payloads.filter((_, i) => valid[i]);
    if (items.length === 0) return payloads.map(() => ({ success: false, channels: [] }));

    const targetIds = Array.from(new Set(items.map((p) => p.targetUserId)));
    const [targetProfiles, prefRows] = await Promise.all([
      db.select({ id: profiles.id, email: profiles.email }).from(profiles).where(inArray(profiles.id, targetIds)),
      db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, targetIds)),
    ]);
    const emailById = new Map(targetProfiles.map((r) => [r.id, r.email]));
    const prefsById = new Map(prefRows.map((r) => [r.userId, r]));
    const allOn = new Proxy({}, { get: () => true }) as any;

    const outcomes = new Map<NotificationEventPayload, { success: boolean; channels: string[] }>();
    const inserts: (typeof notifications.$inferInsert)[] = [];
    const emails: Array<{ payload: NotificationEventPayload; to: string }> = [];

    for (const payload of items) {
      if (!emailById.has(payload.targetUserId)) {
        outcomes.set(payload, { success: false, channels: [] });
        continue;
      }
      const prefs = prefsById.get(payload.targetUserId) ?? allOn;
      const channels: string[] = [];
      outcomes.set(payload, { success: true, channels });

      if (prefs.inAppEnabled && this.isEventEnabledForInApp(payload.type, prefs)) {
        inserts.push({
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
      }
      const email = emailById.get(payload.targetUserId);
      if (email && prefs.emailEnabled && this.isEventEnabledForEmail(payload.type, prefs)) {
        emails.push({ payload, to: email });
      }
    }

    if (inserts.length > 0) {
      await db.insert(notifications).values(inserts);
      await this.invalidateUnreadCaches(inserts.map((r) => r.userId));
    }

    // Email failures must NOT break the business flow — log and continue.
    await Promise.allSettled(
      emails.map(async ({ payload, to }) => {
        try {
          await queueEmail({
            to,
            subject: payload.title,
            type: 'notification',
            html: this.renderEmailHtml(payload.title, payload.message, payload.link),
          });
          outcomes.get(payload)!.channels.push('email');
        } catch (emailErr) {
          console.error(`[NotificationService] Email enqueue failed for ${payload.targetUserId}:`, emailErr);
        }
      })
    );

    let k = 0;
    return payloads.map((p, i) => (valid[i] ? outcomes.get(items[k++])! : { success: false, channels: [] }));
  }

  /**
   * Drop the cached unread count and first notification page for these users in a single DEL, so a new
   * notification shows on the next poll instead of after the cache TTL. (Other list pages age out in 60s.)
   */
  private static async invalidateUnreadCaches(userIds: string[]) {
    if (connection.status !== 'ready') return;
    try {
      const keys = Array.from(new Set(userIds)).flatMap((id) => [
        `notifications:${id}:unread`,
        `notifications:${id}:list:20:0`,
      ]);
      await connection.del(...keys);
    } catch (err) {
      console.error('[NotificationService] Cache invalidation failed:', err);
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
      case NotificationType.CASE_CREATED: return prefs.caseCreatedEmail;
      case NotificationType.OFFER_CREATED: return prefs.offerCreatedEmail;
      case NotificationType.TUTORIAL_CREATED: return prefs.tutorialCreatedEmail;
      case NotificationType.SUPPORT_TICKET_CREATED: return prefs.supportTicketCreatedEmail;
      case NotificationType.SUPPORT_TICKET_UPDATED:
      case NotificationType.SUPPORT_TICKET_RESOLVED:
      case NotificationType.SUPPORT_TICKET_CLOSED: return prefs.supportTicketUpdatedEmail;
      case NotificationType.SUPPORT_CALLBACK_REQUESTED: return prefs.supportCallbackEmail;
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
      case NotificationType.CASE_CREATED: return prefs.caseCreatedInApp;
      case NotificationType.OFFER_CREATED: return prefs.offerCreatedInApp;
      case NotificationType.TUTORIAL_CREATED: return prefs.tutorialCreatedInApp;
      case NotificationType.SUPPORT_TICKET_CREATED: return prefs.supportTicketCreatedInApp;
      case NotificationType.SUPPORT_TICKET_UPDATED:
      case NotificationType.SUPPORT_TICKET_RESOLVED:
      case NotificationType.SUPPORT_TICKET_CLOSED: return prefs.supportTicketUpdatedInApp;
      case NotificationType.SUPPORT_CALLBACK_REQUESTED: return prefs.supportCallbackInApp;
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
