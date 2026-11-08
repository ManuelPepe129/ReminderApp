import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { listMembers } from '../db/schema';
import { requireUser } from '../auth/session';
import type { ChangeEvent } from '../lib/realtime';

/**
 * Server-Sent Events stream: pushes "something changed in list X" hints to
 * members of that list; the client then refetches through the normal
 * (authorized) endpoints. No list data is ever sent over this channel.
 */
export async function eventRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/events/stream', async (req, reply) => {
    const user = requireUser(req);
    const loadMemberships = async () =>
      new Set(
        (
          await deps.db
            .select({ listId: listMembers.listId })
            .from(listMembers)
            .where(eq(listMembers.userId, user.id))
        ).map((r) => r.listId),
      );
    let memberships = await loadMemberships();

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // disable nginx buffering
    });
    res.write('retry: 5000\n\n');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = deps.realtime.subscribe((ev: ChangeEvent) => {
      void (async () => {
        const concernsMe = ev.userIds?.includes(user.id) ?? false;
        if (ev.kind === 'members' || ev.kind === 'list_deleted') {
          if (concernsMe || memberships.has(ev.listId)) {
            memberships = await loadMemberships();
            send({ listId: ev.listId, kind: ev.kind });
          }
          return;
        }
        if (memberships.has(ev.listId)) {
          send({ listId: ev.listId, kind: ev.kind, actionId: ev.actionId });
        }
      })().catch(() => undefined);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
