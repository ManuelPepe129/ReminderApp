import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Rome'),
    locale: text('locale').notNull().default('it'),
    emailVerifiedAt: tstz('email_verified_at'),
    googleSub: text('google_sub'),
    // Notification preferences
    pushEnabled: boolean('push_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end'),
    defaultLeadMinutes: integer('default_lead_minutes'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_google_sub_uq').on(t.googleSub),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256(token) — the raw token only lives in the user's cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    purpose: text('purpose').notNull(),
    redirect: text('redirect'),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash),
    index('auth_tokens_email_idx').on(t.email),
  ],
);

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#2563eb'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const listMembers = pgTable(
  'list_members',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor'] }).notNull(),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.userId] }),
    index('list_members_user_idx').on(t.userId),
    check('list_members_role_ck', sql`${t.role} in ('owner', 'editor')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** When set, the invitation was e-mailed and is single-use. Otherwise it is a reusable link. */
    email: text('email'),
    role: text('role', { enum: ['owner', 'editor'] }).notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('invitations_token_uq').on(t.tokenHash),
    index('invitations_list_idx').on(t.listId),
    index('invitations_inviter_created_idx').on(t.invitedBy, t.createdAt),
  ],
);

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    category: text('category'),
    intervalValue: integer('interval_value').notNull(),
    intervalUnit: text('interval_unit', {
      enum: ['hour', 'day', 'week', 'month', 'year'],
    }).notNull(),
    mode: text('mode', { enum: ['from_completion', 'fixed_schedule'] }).notNull(),
    timezone: text('timezone').notNull(),
    /** Origin of the fixed grid (= first due date, or the last explicit reschedule). */
    anchorAt: tstz('anchor_at').notNull(),
    /** Current due date according to the recurrence rule. */
    dueAt: tstz('due_at').notNull(),
    /** Postponed due date of the current occurrence (does not alter the rule). */
    snoozedUntil: tstz('snoozed_until'),
    effectiveDueAt: tstz('effective_due_at')
      .notNull()
      .generatedAlwaysAs(sql`coalesce(snoozed_until, due_at)`),
    status: text('status', { enum: ['active', 'paused', 'archived'] })
      .notNull()
      .default('active'),
    leadMinutes: integer('lead_minutes'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    lastCompletedAt: tstz('last_completed_at'),
    lastCompletedBy: uuid('last_completed_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('actions_list_idx').on(t.listId),
    index('actions_status_due_idx').on(t.status, t.effectiveDueAt),
    check('actions_interval_ck', sql`${t.intervalValue} between 1 and 999`),
    check('actions_status_ck', sql`${t.status} in ('active', 'paused', 'archived')`),
    check('actions_mode_ck', sql`${t.mode} in ('from_completion', 'fixed_schedule')`),
    check('actions_unit_ck', sql`${t.intervalUnit} in ('hour', 'day', 'week', 'month', 'year')`),
  ],
);

export const actionEvents = pgTable(
  'action_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic sequence: stable ordering for events with the same timestamp. */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['created', 'updated', 'completed', 'snoozed', 'paused', 'resumed', 'archived'],
    }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    /** Due date of the occurrence the event refers to. */
    dueAt: tstz('due_at'),
    /** New due date after the event (next occurrence or snooze target). */
    newDueAt: tstz('new_due_at'),
    note: text('note'),
  },
  (t) => [
    index('action_events_action_idx').on(t.actionId, t.occurredAt),
    index('action_events_list_type_idx').on(t.listId, t.type, t.occurredAt),
  ],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSuccessAt: tstz('last_success_at'),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/**
 * One row per (user, action, occurrence, kind). The UNIQUE constraint is the
 * de-duplication mechanism: the scheduler "claims" a notification with
 * INSERT ... ON CONFLICT DO NOTHING and only sends it when the insert succeeds.
 */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    dueAt: tstz('due_at').notNull(),
    kind: text('kind', { enum: ['due', 'lead'] }).notNull(),
    createdAt: createdAt(),
    pushStatus: text('push_status'),
    emailStatus: text('email_status'),
  },
  (t) => [
    uniqueIndex('notification_log_dedupe_uq').on(t.userId, t.actionId, t.dueAt, t.kind),
    index('notification_log_created_idx').on(t.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type ActionEventRow = typeof actionEvents.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
