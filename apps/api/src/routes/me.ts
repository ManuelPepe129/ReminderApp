import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { preferencesSchema, pushSubscriptionSchema } from '@reminder/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { pushSubscriptions, users } from '../db/schema';
import { requireUser } from '../auth/session';
import { HttpError } from '../lib/errors';
import { parse } from '../lib/validate';
import { toPreferencesDto } from '../services/users';

export async function meRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db } = deps;

  app.get('/api/me/preferences', async (req) => toPreferencesDto(requireUser(req)));

  app.patch('/api/me/preferences', async (req) => {
    const user = requireUser(req);
    const input = parse(preferencesSchema, req.body);
    if (Object.keys(input).length === 0) return toPreferencesDto(user);
    const [updated] = await db.update(users).set(input).where(eq(users.id, user.id)).returning();
    return toPreferencesDto(updated ?? user);
  });

  // ---------- Web Push ----------
  app.get('/api/push/public-key', async () => {
    if (!deps.push.enabled || !deps.push.publicKey) throw new HttpError(404, 'push_not_configured');
    return { publicKey: deps.push.publicKey };
  });

  app.post('/api/push/subscriptions', async (req, reply) => {
    const user = requireUser(req);
    const sub = parse(pushSubscriptionSchema, req.body);
    // Upsert by endpoint: a browser endpoint belongs to whoever registered it last.
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failureCount: 0 },
      });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/push/subscriptions', async (req, reply) => {
    const user = requireUser(req);
    const { endpoint } = parse(z.object({ endpoint: z.string().max(2000) }), req.body);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
    return reply.code(204).send();
  });

  app.post(
    '/api/push/test',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req);
      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id));
      let sent = 0;
      for (const s of subs) {
        const res = await deps.push.send(s, {
          title: user.locale === 'en' ? 'Test notification' : 'Notifica di prova',
          body: user.locale === 'en' ? 'Push notifications work!' : 'Le notifiche push funzionano!',
          url: '/',
          tag: 'test',
        });
        if (res === 'ok') sent += 1;
        if (res === 'gone') {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        }
      }
      return { sent };
    },
  );
}
