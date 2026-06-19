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
  CASE_CREATED = 'case_created',
  CASE_STATUS_CHANGED = 'case_status_changed',
  SUPPORT_TICKET_CREATED = 'support_ticket_created',
  SUPPORT_TICKET_UPDATED = 'support_ticket_updated',
  SUPPORT_TICKET_RESOLVED = 'support_ticket_resolved',
  SUPPORT_TICKET_CLOSED = 'support_ticket_closed',
  SUPPORT_CALLBACK_REQUESTED = 'support_callback_requested',
  OFFER_CREATED = 'offer_created',
  TUTORIAL_CREATED = 'tutorial_created',
  CLIENT_REGISTERED = 'client_registered',
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
  metadata?: Record<string, unknown>;
}
