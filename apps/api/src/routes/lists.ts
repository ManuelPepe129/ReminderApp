import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  listCreateSchema,
  listUpdateSchema,
  memberUpdateSchema,
  uuidSchema,
  type ListDto,
  type MemberDto,
} from '@reminder/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { actions, listMembers, lists, users } from '../db/schema';
import { requireUser } from '../auth/session';
import { conflict, forbidden, notFound } from '../lib/errors';
import { parse } from '../lib/validate';
import { requireListRole } from '../services/access';

const idParams = z.object({ id: uuidSchema });
const memberParams = z.object({ id: uuidSchema, userId: uuidSchema });

export async function listRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db } = deps;

  async function loadListDto(listId: string, userId: string): Promise<ListDto> {
    const rows = await db
      .select({
        id: lists.id,
        name: lists.name,
        color: lists.color,
        createdAt: lists.createdAt,
        role: listMembers.role,
        memberCount: sql<number>`(select count(*)::int from ${listMembers} lm where lm.list_id = ${lists.id})`,
      })
      .from(lists)
      .innerJoin(listMembers, and(eq(listMembers.listId, lists.id), eq(listMembers.userId, userId)))
      .where(eq(lists.id, listId));
    const r = rows[0];
    if (!r) throw notFound('list_not_found');
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  app.get('/api/lists', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({
        id: lists.id,
        name: lists.name,
        color: lists.color,
        createdAt: lists.createdAt,
        role: listMembers.role,
        memberCount: sql<number>`(select count(*)::int from ${listMembers} lm where lm.list_id = ${lists.id})`,
      })
      .from(lists)
      .innerJoin(listMembers, and(eq(listMembers.listId, lists.id), eq(listMembers.userId, user.id)))
      .orderBy(asc(lists.createdAt));
    return rows.map((r): ListDto => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });

  app.post('/api/lists', async (req, reply) => {
    const user = requireUser(req);
    const input = parse(listCreateSchema, req.body);
    const list = await db.transaction(async (tx) => {
      const [l] = await tx
        .insert(lists)
        .values({ name: input.name, ...(input.color ? { color: input.color } : {}), createdBy: user.id })
        .returning();
      if (!l) throw new Error('insert failed');
      await tx.insert(listMembers).values({ listId: l.id, userId: user.id, role: 'owner' });
      return l;
    });
    return reply.code(201).send(await loadListDto(list.id, user.id));
  });

  app.get('/api/lists/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    return loadListDto(id, user.id);
  });

  app.patch('/api/lists/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await requireListRole(db, id, user.id, ['owner']);
    const input = parse(listUpdateSchema, req.body);
    if (Object.keys(input).length > 0) await db.update(lists).set(input).where(eq(lists.id, id));
    await deps.realtime.publish({ listId: id, kind: 'list' });
    return loadListDto(id, user.id);
  });

  app.delete('/api/lists/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await requireListRole(db, id, user.id, ['owner']);
    const members = await db
      .select({ userId: listMembers.userId })
      .from(listMembers)
      .where(eq(listMembers.listId, id));
    await db.delete(lists).where(eq(lists.id, id));
    await deps.realtime.publish({
      listId: id,
      kind: 'list_deleted',
      userIds: members.map((m) => m.userId),
    });
    return reply.code(204).send();
  });

  // ---------- Members ----------
  app.get('/api/lists/:id/members', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await requireListRole(db, id, user.id);
    const rows = await db
      .select({
        userId: listMembers.userId,
        role: listMembers.role,
        joinedAt: listMembers.joinedAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(listMembers)
      .innerJoin(users, eq(users.id, listMembers.userId))
      .where(eq(listMembers.listId, id))
      .orderBy(asc(listMembers.joinedAt));
    return rows.map((r): MemberDto => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
  });

  app.patch('/api/lists/:id/members/:userId', async (req) => {
    const user = requireUser(req);
    const { id, userId } = parse(memberParams, req.params);
    await requireListRole(db, id, user.id, ['owner']);
    const { role } = parse(memberUpdateSchema, req.body);
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: listMembers.role })
        .from(listMembers)
        .where(and(eq(listMembers.listId, id), eq(listMembers.userId, userId)))
        .for('update');
      if (!target) throw notFound('member_not_found');
      if (target.role === 'owner' && role !== 'owner') await assertAnotherOwner(tx, id, userId);
      await tx
        .update(listMembers)
        .set({ role })
        .where(and(eq(listMembers.listId, id), eq(listMembers.userId, userId)));
    });
    await deps.realtime.publish({ listId: id, kind: 'members', userIds: [userId] });
    return { ok: true };
  });

  /** Owner removes a member, or any member leaves (userId = self). */
  app.delete('/api/lists/:id/members/:userId', async (req, reply) => {
    const user = requireUser(req);
    const { id, userId } = parse(memberParams, req.params);
    const myRole = await requireListRole(db, id, user.id);
    const leaving = userId === user.id;
    if (!leaving && myRole !== 'owner') throw forbidden('insufficient_role');
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: listMembers.role })
        .from(listMembers)
        .where(and(eq(listMembers.listId, id), eq(listMembers.userId, userId)))
        .for('update');
      if (!target) throw notFound('member_not_found');
      if (target.role === 'owner') await assertAnotherOwner(tx, id, userId);
      await tx
        .delete(listMembers)
        .where(and(eq(listMembers.listId, id), eq(listMembers.userId, userId)));
      // Actions assigned to the removed member become unassigned.
      await tx
        .update(actions)
        .set({ assigneeId: null })
        .where(and(eq(actions.listId, id), eq(actions.assigneeId, userId)));
    });
    await deps.realtime.publish({ listId: id, kind: 'members', userIds: [userId] });
    return reply.code(204).send();
  });
}

/** A list must always keep at least one owner. */
async function assertAnotherOwner(tx: AppDeps['db'], listId: string, exceptUserId: string) {
  const others = await tx
    .select({ userId: listMembers.userId })
    .from(listMembers)
    .where(
      and(
        eq(listMembers.listId, listId),
        eq(listMembers.role, 'owner'),
        ne(listMembers.userId, exceptUserId),
      ),
    )
    .limit(1);
  if (others.length === 0) throw conflict('last_owner');
}
