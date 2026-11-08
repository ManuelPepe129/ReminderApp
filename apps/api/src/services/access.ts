import { and, eq } from 'drizzle-orm';
import type { Role } from '@reminder/shared';
import type { Db } from '../db';
import { actions, listMembers, type ActionRow } from '../db/schema';
import { forbidden, notFound } from '../lib/errors';

/**
 * Central authorization helpers. Every list-scoped read or write MUST go
 * through one of these. Non-members get 404 (not 403) so that the existence
 * of other users' lists/actions is never revealed.
 */
export async function getRole(db: Db, listId: string, userId: string): Promise<Role | null> {
  const rows = await db
    .select({ role: listMembers.role })
    .from(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

export async function requireListRole(
  db: Db,
  listId: string,
  userId: string,
  allowed: readonly Role[] = ['owner', 'editor'],
): Promise<Role> {
  const role = await getRole(db, listId, userId);
  if (!role) throw notFound('list_not_found');
  if (!allowed.includes(role)) throw forbidden('insufficient_role');
  return role;
}

export async function requireActionAccess(
  db: Db,
  actionId: string,
  userId: string,
  allowed: readonly Role[] = ['owner', 'editor'],
): Promise<{ action: ActionRow; role: Role }> {
  const rows = await db
    .select({ action: actions, role: listMembers.role })
    .from(actions)
    .innerJoin(
      listMembers,
      and(eq(listMembers.listId, actions.listId), eq(listMembers.userId, userId)),
    )
    .where(eq(actions.id, actionId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('action_not_found');
  if (!allowed.includes(row.role)) throw forbidden('insufficient_role');
  return row;
}

export async function isMember(db: Db, listId: string, userId: string): Promise<boolean> {
  return (await getRole(db, listId, userId)) !== null;
}
