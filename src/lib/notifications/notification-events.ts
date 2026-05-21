export enum NotificationType {
  CASE_ASSIGNED = 'case_assigned',
  CASE_FEEDBACK = 'case_feedback',
  CASE_APPROVED = 'case_approved',
  CASE_REJECTED = 'case_rejected',
  CASE_HOLD = 'case_hold',
  CASE_CANCEL = 'case_cancel',
  CASE_REMINDER = 'case_reminder',
  CHAT_MESSAGE = 'chat_message',
  WELCOME = 'welcome',
  PLAN_UPGRADED = 'plan_upgraded',
}

export interface NotificationEventPayload {
  type: NotificationType | string;
  actorUserId: string;
  targetUserId: string;
  entityId?: string;      // e.g., caseId or messageId
  entityType?: string;    // e.g., 'case', 'chat'
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, any>;
}
