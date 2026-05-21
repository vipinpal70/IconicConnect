import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { profiles } from './profile';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 100 }).notNull(), // e.g., 'case_assigned', 'case_approved', etc.
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  read: boolean('is_read').default(false).notNull(),
  dismissed: boolean('is_dismissed').default(false).notNull(),
  link: varchar('link', { length: 255 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('notifications_user_id_idx').on(table.userId),
    createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
    readIdx: index('notifications_read_idx').on(table.read),
    typeIdx: index('notifications_type_idx').on(table.type),
    userReadIdx: index('notifications_user_read_idx').on(table.userId, table.read),
    userDismissedIdx: index('notifications_user_dismissed_idx').on(table.userId, table.dismissed),
  };
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull().unique(),
  
  // Master Switches
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  inAppEnabled: boolean('in_app_enabled').default(true).notNull(),

  // Event Switches
  caseAssignedEmail: boolean('case_assigned_email').default(true).notNull(),
  caseAssignedInApp: boolean('case_assigned_in_app').default(true).notNull(),

  caseFeedbackEmail: boolean('case_feedback_email').default(true).notNull(),
  caseFeedbackInApp: boolean('case_feedback_in_app').default(true).notNull(),

  caseApprovedEmail: boolean('case_approved_email').default(true).notNull(),
  caseApprovedInApp: boolean('case_approved_in_app').default(true).notNull(),

  caseRejectedEmail: boolean('case_rejected_email').default(true).notNull(),
  caseRejectedInApp: boolean('case_rejected_in_app').default(true).notNull(),

  caseHoldEmail: boolean('case_hold_email').default(true).notNull(),
  caseHoldInApp: boolean('case_hold_in_app').default(true).notNull(),

  caseCancelEmail: boolean('case_cancel_email').default(true).notNull(),
  caseCancelInApp: boolean('case_cancel_in_app').default(true).notNull(),

  caseReminderEmail: boolean('case_reminder_email').default(true).notNull(),
  caseReminderInApp: boolean('case_reminder_in_app').default(true).notNull(),

  chatMessageEmail: boolean('chat_message_email').default(true).notNull(),
  chatMessageInApp: boolean('chat_message_in_app').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
