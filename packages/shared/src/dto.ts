/** Wire types returned by the API (dates are ISO strings). */
import type { IntervalUnit, RecurrenceMode } from './recurrence';
import type { ActionEventType, ActionStatus, Locale, Role } from './schemas';

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: Locale;
  emailVerified: boolean;
  hasPassword: boolean;
}

export interface PreferencesDto {
  displayName: string;
  timezone: string;
  locale: Locale;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  defaultLeadMinutes: number | null;
}

export interface ListDto {
  id: string;
  name: string;
  color: string;
  role: Role;
  memberCount: number;
  createdAt: string;
}

export interface MemberDto {
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface UserRefDto {
  id: string;
  displayName: string;
}

export interface ActionDto {
  id: string;
  listId: string;
  title: string;
  notes: string | null;
  category: string | null;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  mode: RecurrenceMode;
  timezone: string;
  anchorAt: string;
  dueAt: string;
  snoozedUntil: string | null;
  /** snoozedUntil ?? dueAt */
  effectiveDueAt: string;
  status: ActionStatus;
  leadMinutes: number | null;
  assignee: UserRefDto | null;
  lastCompletedAt: string | null;
  lastCompletedBy: UserRefDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionEventDto {
  id: string;
  actionId: string;
  type: ActionEventType;
  user: UserRefDto | null;
  occurredAt: string;
  dueAt: string | null;
  newDueAt: string | null;
  note: string | null;
}

export type OccurrenceStatus = 'overdue' | 'planned' | 'completed';

export interface CalendarOccurrenceDto {
  actionId: string;
  listId: string;
  title: string;
  category: string | null;
  at: string;
  status: OccurrenceStatus;
  /** true when this is the action's current pending occurrence (actionable). */
  current: boolean;
  completedBy: UserRefDto | null;
}

export interface InvitationDto {
  id: string;
  listId: string;
  email: string | null;
  role: Role;
  invitedBy: UserRefDto | null;
  createdAt: string;
  expiresAt: string;
}

export interface InvitationPreviewDto {
  listName: string;
  invitedBy: string | null;
  role: Role;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}
