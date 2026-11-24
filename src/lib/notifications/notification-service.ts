import { users } from '@/src/db/schema/profile'
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { loadPreference, loadPreferences } from './preferences';
import { profiles } from '@/src/db/schema/profile';
import { eq, inArray } from 'drizzle-orm';
import { redis as connection } from '@/src/lib/redis';
import { queueEmail } from '@/src/lib/queue/jobs';
import { NotificationEventPayload, NotificationType } from './notification-events';
import { renderNotificationEmail } from './email-template';

export class NotificationService {
  /**
   * Safe preference loader with automatic transactional creation.
   * If a preference record does not exist for the user, it safely creates one
   * with all defaults enabled.
   */
  static async getPreferences(userId: string) {
    return loadPreference(userId);
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
   * `channelsAllowed` limits where this call may deliver (case chat sends in-app at once and email later).
   */
  static async dispatchMany(
    payloads: NotificationEventPayload[],
    channelsAllowed: { inApp?: boolean; email?: boolean } = {},
  ): Promise<{ success: boolean; channels: string[] }[]> {
    const { inApp: inAppAllowed = true, email: emailAllowed = true } = channelsAllowed;
    const valid = payloads.map((p) => Boolean(p.type && p.actorUserId && p.targetUserId && p.title && p.message));
    const items = payloads.filter((_, i) => valid[i]);
    if (items.length === 0) return payloads.map(() => ({ success: false, channels: [] }));

    const targetIds = Array.from(new Set(items.map((p) => p.targetUserId)));
    const [targetProfiles, prefRows] = await Promise.all([
      db.select({ id: profiles.id, email: users.email }).from(profiles).innerJoin(users, eq(users.id, profiles.id)).where(inArray(profiles.id, targetIds)),
      loadPreferences(targetIds),
    ]);
    const emailById = new Map(targetProfiles.map((r) => [r.id, r.email]));
    const prefsById = prefRows; // already defaulted to all-enabled for users with no rows

    const outcomes = new Map<NotificationEventPayload, { success: boolean; channels: string[] }>();
    const inserts: (typeof notifications.$inferInsert)[] = [];
    const emails: Array<{ payload: NotificationEventPayload; to: string }> = [];

    for (const payload of items) {
      if (!emailById.has(payload.targetUserId)) {
        outcomes.set(payload, { success: false, channels: [] });
        continue;
      }
      const prefs = prefsById.get(payload.targetUserId)!;
      const channels: string[] = [];
      outcomes.set(payload, { success: true, channels });

      if (inAppAllowed && prefs.inAppEnabled && this.isEventEnabledForInApp(payload.type, prefs)) {
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
      if (emailAllowed && email && prefs.emailEnabled && this.isEventEnabledForEmail(payload.type, prefs)) {
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
            html: renderNotificationEmail(payload.title, payload.message, payload.link),
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
  static async invalidateUnreadCaches(userIds: string[]) {
    if (userIds.length === 0 || connection.status !== 'ready') return;
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
      // One email per chat message would flood inboxes; unread conversations get a throttled digest instead.
      case NotificationType.SUPPORT_MESSAGE: return false;
      // Reply-time alerts fire every few minutes across the team; in-app only.
      case NotificationType.SUPPORT_SLA_ALERT: return false;
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
      case NotificationType.SUPPORT_MESSAGE: return prefs.supportTicketUpdatedInApp;
      case NotificationType.SUPPORT_SLA_ALERT: return prefs.supportTicketUpdatedInApp;
      default: return true;
    }
  }

}
