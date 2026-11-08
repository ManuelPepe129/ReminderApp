import { z } from 'zod';
import {
  INTERVAL_UNITS,
  MAX_INTERVAL_VALUE,
  RECURRENCE_MODES,
  isValidTimeZone,
} from '../recurrence';

export const ROLES = ['owner', 'editor'] as const;
export type Role = (typeof ROLES)[number];

export const ACTION_STATUSES = ['active', 'paused', 'archived'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const EVENT_TYPES = [
  'created',
  'updated',
  'completed',
  'snoozed',
  'paused',
  'resumed',
  'archived',
] as const;
export type ActionEventType = (typeof EVENT_TYPES)[number];

export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Max lead time for "pre-notice" notifications: 30 days. */
export const MAX_LEAD_MINUTES = 60 * 24 * 30;

const isoDate = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), 'invalid_date');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordSchema = z.string().min(8, 'password_too_short').max(200);
export const displayNameSchema = z.string().trim().min(1).max(80);
export const timezoneSchema = z.string().max(64).refine(isValidTimeZone, 'invalid_timezone');
export const uuidSchema = z.uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');

// ---------- Auth ----------
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  timezone: timezoneSchema.optional(),
  locale: z.enum(LOCALES).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  /** Optional path to return to after login (must be a relative app path). */
  redirect: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[\w\-/?=&.]*$/)
    .optional(),
});
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });

// ---------- Lists ----------
export const listColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const listCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: listColorSchema.optional(),
});
export const listUpdateSchema = listCreateSchema.partial();
export type ListCreateInput = z.infer<typeof listCreateSchema>;

// ---------- Actions ----------
const actionBase = {
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  intervalValue: z.number().int().min(1).max(MAX_INTERVAL_VALUE),
  intervalUnit: z.enum(INTERVAL_UNITS),
  mode: z.enum(RECURRENCE_MODES),
  timezone: timezoneSchema,
  assigneeId: uuidSchema.nullable().optional(),
  leadMinutes: z.number().int().min(0).max(MAX_LEAD_MINUTES).nullable().optional(),
};

export const actionCreateSchema = z.object({
  listId: uuidSchema,
  firstDueAt: isoDate,
  ...actionBase,
});
export type ActionCreateInput = z.infer<typeof actionCreateSchema>;

export const actionUpdateSchema = z
  .object({
    listId: uuidSchema,
    /** Reschedules the action: resets the grid anchor and the current due date. */
    nextDueAt: isoDate,
    status: z.enum(ACTION_STATUSES),
    ...actionBase,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty_update');
export type ActionUpdateInput = z.infer<typeof actionUpdateSchema>;

export const completeSchema = z.object({
  /** Defaults to now. Cannot be in the future (5 minutes of clock skew tolerated). */
  completedAt: isoDate.optional(),
  note: z.string().trim().max(500).optional(),
  /**
   * The effective due date the client saw. If the action has meanwhile been
   * completed/snoozed by someone else, the server answers 409 instead of
   * completing the next occurrence by mistake.
   */
  expectedDueAt: isoDate.optional(),
});
export type CompleteInput = z.infer<typeof completeSchema>;

export const snoozeSchema = z.object({ until: isoDate });
export type SnoozeInput = z.infer<typeof snoozeSchema>;

export const actionQuerySchema = z.object({
  listId: uuidSchema.optional(),
  category: z.string().max(40).optional(),
  assigneeId: z.union([uuidSchema, z.literal('none'), z.literal('me')]).optional(),
  status: z.enum(ACTION_STATUSES).optional(),
});

export const calendarQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    listId: uuidSchema.optional(),
    category: z.string().max(40).optional(),
    assigneeId: z.union([uuidSchema, z.literal('none'), z.literal('me')]).optional(),
  })
  .refine((v) => v.to.getTime() > v.from.getTime(), 'invalid_range')
  .refine((v) => v.to.getTime() - v.from.getTime() <= 62 * 24 * 3_600_000, 'range_too_large');

// ---------- Sharing ----------
export const inviteCreateSchema = z.object({
  email: emailSchema.optional(),
  role: z.enum(ROLES).default('editor'),
});
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

export const memberUpdateSchema = z.object({ role: z.enum(ROLES) });

// ---------- Preferences & push ----------
export const preferencesSchema = z
  .object({
    displayName: displayNameSchema,
    timezone: timezoneSchema,
    locale: z.enum(LOCALES),
    pushEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
    defaultLeadMinutes: z.number().int().min(0).max(MAX_LEAD_MINUTES).nullable(),
  })
  .partial();
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
