import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  inviteCreateSchema,
  uuidSchema,
  type InvitationDto,
  type InvitationPreviewDto,
} from '@reminder/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { invitations, listMembers, lists, users } from '../db/schema';
import { requireUser } from '../auth/session';
import { randomToken, sha256 } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { invitationEmail } from '../lib/mailer';
import { parse } from '../lib/validate';
import { requireListRole } from '../services/access';

const INVITE_TTL_MS = 7 * 86_400_000;
const idParams = z.object({ id: uuidSchema });
const invParams = z.object({ id: uuidSchema, invitationId: uuidSchema });
const tokenParams = z.object({ token: z.string().min(20).max(200) });

export async function invitationRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, config } = deps;

  app.get('/api/lists/:id/invitations', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await requireListRole(db, id, user.id, ['owner']);
    const rows = await db
      .select({ inv: invitations, inviterName: users.displayName })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.listId, id),
          isNull(invitations.revokedAt),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, deps.now()),
        ),
      )
      .orderBy(desc(invitations.createdAt));
    return rows.map(({ inv, inviterName }): InvitationDto => ({
      id: inv.id,
      listId: inv.listId,
      email: inv.email,
      role: inv.role,
      invitedBy: inv.invitedBy ? { id: inv.invitedBy, displayName: inviterName ?? '' } : null,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
    }));
  });

  /**
   * Creates an invitation. With an e-mail it is sent by mail and is single-use;
   * without, the returned link can be shared and reused until it expires or is revoked.
   * The raw token is only returned once (only its hash is stored).
   */
  app.post(
    '/api/lists/:id/invitations',
    {
      config: {
        rateLimit: {
          max: config.inviteRateLimitPerHour,
          timeWindow: '1 hour',
          keyGenerator: (req) => `invite:${req.user?.id ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParams, req.params);
      await requireListRole(db, id, user.id, ['owner']);
      const input = parse(inviteCreateSchema, req.body);
      const [list] = await db.select().from(lists).where(eq(lists.id, id));
      if (!list) throw notFound('list_not_found');

      const token = randomToken(32);
      const [inv] = await db
        .insert(invitations)
        .values({
          listId: id,
          tokenHash: sha256(token),
          email: input.email ?? null,
          role: input.role,
          invitedBy: user.id,
          expiresAt: new Date(deps.now().getTime() + INVITE_TTL_MS),
        })
        .returning();
      if (!inv) throw new Error('insert failed');
      const url = `${config.appOrigin}/inviti/${encodeURIComponent(token)}`;
      if (input.email) {
        const [recipient] = await db
          .select({ locale: users.locale })
          .from(users)
          .where(eq(users.email, input.email));
        try {
          await deps.mailer.send(
            invitationEmail(
              input.email,
              url,
              user.displayName,
              list.name,
              recipient?.locale ?? user.locale,
            ),
          );
        } catch (err) {
          req.log.error({ err }, 'invitation e-mail failed');
        }
      }
      return reply.code(201).send({
        invitation: {
          id: inv.id,
          listId: inv.listId,
          email: inv.email,
          role: inv.role,
          invitedBy: { id: user.id, displayName: user.displayName },
          createdAt: inv.createdAt.toISOString(),
          expiresAt: inv.expiresAt.toISOString(),
        } satisfies InvitationDto,
        url,
      });
    },
  );

  app.delete('/api/lists/:id/invitations/:invitationId', async (req, reply) => {
    const user = requireUser(req);
    const { id, invitationId } = parse(invParams, req.params);
    await requireListRole(db, id, user.id, ['owner']);
    const res = await db
      .update(invitations)
      .set({ revokedAt: deps.now() })
      .where(and(eq(invitations.id, invitationId), eq(invitations.listId, id)))
      .returning({ id: invitations.id });
    if (res.length === 0) throw notFound('invitation_not_found');
    return reply.code(204).send();
  });

  async function findValidInvitation(token: string) {
    const now = deps.now();
    const rows = await db
      .select({ inv: invitations, listName: lists.name, inviterName: users.displayName })
      .from(invitations)
      .innerJoin(lists, eq(lists.id, invitations.listId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.tokenHash, sha256(token)),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
          // e-mail invitations are single-use
          sql`(${invitations.email} is null or ${invitations.acceptedAt} is null)`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Public preview (the token itself is the secret). */
  app.get(
    '/api/invitations/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = parse(tokenParams, req.params);
      const found = await findValidInvitation(token);
      if (!found) throw new HttpError(404, 'invitation_invalid');
      return {
        listName: found.listName,
        invitedBy: found.inviterName,
        role: found.inv.role,
        expiresAt: found.inv.expiresAt.toISOString(),
      } satisfies InvitationPreviewDto;
    },
  );

  app.post(
    '/api/invitations/:token/accept',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req);
      const { token } = parse(tokenParams, req.params);
      const found = await findValidInvitation(token);
      if (!found) throw new HttpError(404, 'invitation_invalid');
      const { inv } = found;
      await db.transaction(async (tx) => {
        await tx
          .insert(listMembers)
          .values({ listId: inv.listId, userId: user.id, role: inv.role })
          .onConflictDoNothing();
        if (inv.email) {
          await tx
            .update(invitations)
            .set({ acceptedAt: deps.now(), acceptedBy: user.id })
            .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt)));
        }
      });
      await deps.realtime.publish({ listId: inv.listId, kind: 'members', userIds: [user.id] });
      return { listId: inv.listId };
    },
  );
}
