import type { Locale, PreferencesDto, UserDto } from '@reminder/shared';
import type { Db } from '../db';
import { listMembers, lists, users, type UserRow } from '../db/schema';

const DEFAULT_LIST_NAME: Record<Locale, string> = { it: 'Personale', en: 'Personal' };

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    timezone: u.timezone,
    locale: (u.locale as Locale) ?? 'it',
    emailVerified: u.emailVerifiedAt !== null,
    hasPassword: u.passwordHash !== null,
  };
}

export function toPreferencesDto(u: UserRow): PreferencesDto {
  return {
    displayName: u.displayName,
    timezone: u.timezone,
    locale: (u.locale as Locale) ?? 'it',
    pushEnabled: u.pushEnabled,
    emailEnabled: u.emailEnabled,
    quietStart: u.quietStart,
    quietEnd: u.quietEnd,
    defaultLeadMinutes: u.defaultLeadMinutes,
  };
}

/** Creates a user together with a first personal list (owner). */
export async function createUser(
  db: Db,
  input: {
    email: string;
    displayName: string;
    passwordHash?: string | null;
    timezone?: string | undefined;
    locale?: Locale | undefined;
    emailVerifiedAt?: Date | null;
    googleSub?: string | null;
  },
): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const locale = input.locale ?? 'it';
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash ?? null,
        timezone: input.timezone ?? 'Europe/Rome',
        locale,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        googleSub: input.googleSub ?? null,
      })
      .returning();
    if (!user) throw new Error('user insert failed');
    const [list] = await tx
      .insert(lists)
      .values({ name: DEFAULT_LIST_NAME[locale], createdBy: user.id })
      .returning();
    if (!list) throw new Error('list insert failed');
    await tx.insert(listMembers).values({ listId: list.id, userId: user.id, role: 'owner' });
    return user;
  });
}

/** Display name fallback derived from an e-mail address. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 80) || 'Utente';
}
