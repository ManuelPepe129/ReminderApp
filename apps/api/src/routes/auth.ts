import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  loginSchema,
  magicLinkRequestSchema,
  registerSchema,
  tokenSchema,
} from '@reminder/shared';
import type { AppDeps } from '../deps';
import { authTokens, users } from '../db/schema';
import { endSession, requireUser, startSession } from '../auth/session';
import { randomToken, sha256 } from '../lib/crypto';
import { HttpError, conflict, unauthorized } from '../lib/errors';
import { magicLinkEmail } from '../lib/mailer';
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password';
import { parse } from '../lib/validate';
import { createUser, nameFromEmail, toUserDto } from '../services/users';

const MAGIC_LINK_TTL_MS = 15 * 60_000;

export async function authRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, config } = deps;
  const authLimit = {
    rateLimit: { max: config.authRateLimitPer15Min, timeWindow: '15 minutes' },
  };

  app.get('/api/auth/me', async (req) => toUserDto(requireUser(req)));

  app.post('/api/auth/register', { config: authLimit }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing.length > 0) throw conflict('email_taken');
    const user = await createUser(db, {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
      timezone: input.timezone,
      locale: input.locale,
    });
    await startSession(req, reply, deps, user.id);
    return reply.code(201).send(toUserDto(user));
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user?.passwordHash) {
      await dummyVerify(input.password); // keep timing similar for unknown e-mails
      throw unauthorized('invalid_credentials');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw unauthorized('invalid_credentials');
    }
    await startSession(req, reply, deps, user.id);
    return toUserDto(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await endSession(req, reply, deps);
    return reply.code(204).send();
  });

  /** Sends a single-use sign-in link. Always answers 204 to avoid account enumeration. */
  app.post('/api/auth/magic-link', { config: authLimit }, async (req, reply) => {
    const input = parse(magicLinkRequestSchema, req.body);
    const token = randomToken(32);
    await db.insert(authTokens).values({
      tokenHash: sha256(token),
      email: input.email,
      purpose: 'magic_link',
      redirect: input.redirect ?? null,
      expiresAt: new Date(deps.now().getTime() + MAGIC_LINK_TTL_MS),
    });
    const [user] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.email, input.email));
    const url = `${config.appOrigin}/auth/magic?token=${encodeURIComponent(token)}`;
    try {
      await deps.mailer.send(magicLinkEmail(input.email, url, user?.locale ?? 'it'));
    } catch (err) {
      req.log.error({ err }, 'magic link e-mail failed');
      throw new HttpError(503, 'mail_unavailable');
    }
    return reply.code(204).send();
  });

  /** Consumes a magic link; creates the account on first use (passwordless sign-up). */
  app.post('/api/auth/magic-link/verify', { config: authLimit }, async (req, reply) => {
    const { token } = parse(tokenSchema, req.body);
    const now = deps.now();
    // Atomically mark as used so that a token can never be consumed twice.
    const [row] = await db
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.tokenHash, sha256(token)),
          eq(authTokens.purpose, 'magic_link'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, now),
        ),
      )
      .returning();
    if (!row) throw new HttpError(400, 'invalid_or_expired_token');

    let [user] = await db.select().from(users).where(eq(users.email, row.email)).limit(1);
    if (!user) {
      user = await createUser(db, {
        email: row.email,
        displayName: nameFromEmail(row.email),
        emailVerifiedAt: now,
      });
    } else if (!user.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, user.id));
      user = { ...user, emailVerifiedAt: now };
    }
    await startSession(req, reply, deps, user.id);
    return { user: toUserDto(user), redirect: row.redirect };
  });
}
