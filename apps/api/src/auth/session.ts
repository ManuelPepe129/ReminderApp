import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps';
import { sessions, users, type UserRow } from '../db/schema';
import { randomToken, safeEqual, sha256 } from '../lib/crypto';
import { forbidden, unauthorized } from '../lib/errors';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionId: string | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DAY_MS = 86_400_000;

export function registerSessionHooks(app: FastifyInstance, deps: AppDeps): void {
  const { config } = deps;
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req, reply) => {
    // --- CSRF: Origin check + double-submit cookie for state-changing requests.
    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf) {
      csrf = randomToken(24);
      reply.setCookie(CSRF_COOKIE, csrf, {
        path: '/',
        sameSite: 'lax',
        secure: config.cookieSecure,
        httpOnly: false, // must be readable by the SPA to echo it in a header
      });
      req.cookies[CSRF_COOKIE] = csrf;
    }
    if (UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== config.appOrigin) throw forbidden('bad_origin');
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, csrf)) throw forbidden('csrf');
    }

    // --- Session
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const id = sha256(raw);
    const now = deps.now();
    const rows = await deps.db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    req.user = row.user;
    req.sessionId = id;
    // Sliding expiration: renew when less than half of the TTL is left.
    const ttl = config.sessionTtlDays * DAY_MS;
    if (row.expiresAt.getTime() - now.getTime() < ttl / 2) {
      const expiresAt = new Date(now.getTime() + ttl);
      await deps.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
      setSessionCookie(reply, deps, raw, expiresAt);
    }
  });
}

function setSessionCookie(reply: FastifyReply, deps: AppDeps, token: string, expires: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.cookieSecure,
    expires,
  });
}

export async function startSession(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  userId: string,
): Promise<void> {
  // Rotate: never reuse a pre-existing session id (session fixation).
  if (req.sessionId) await deps.db.delete(sessions).where(eq(sessions.id, req.sessionId));
  const token = randomToken(32);
  const expiresAt = new Date(deps.now().getTime() + deps.config.sessionTtlDays * DAY_MS);
  await deps.db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  });
  setSessionCookie(reply, deps, token, expiresAt);
}

export async function endSession(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
): Promise<void> {
  if (req.sessionId) await deps.db.delete(sessions).where(eq(sessions.id, req.sessionId));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}
