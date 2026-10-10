import { pgTable, uuid, varchar, timestamp, boolean, text, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { profiles } from './profile';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(), // open set: adding an event type needs no migration
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  read: boolean('is_read').default(false).notNull(),
  dismissed: boolean('is_dismissed').default(false).notNull(),
  link: text('link'),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Master switches. Absent row => everything enabled. */
export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  inAppEnabled: boolean('in_app_enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One row per (user, event). Absent row => enabled, so only opt-outs are stored. */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  inAppEnabled: boolean('in_app_enabled').default(true).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.eventType] }) }));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
