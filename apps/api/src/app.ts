import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { AppDeps } from './deps';
import { registerSessionHooks } from './auth/session';
import { HttpError } from './lib/errors';
import { actionRoutes } from './routes/actions';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { invitationRoutes } from './routes/invitations';
import { listRoutes } from './routes/lists';
import { meRoutes } from './routes/me';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'],
            ...(config.env === 'development'
              ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
              : {}),
          },
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    // The API only serves JSON; the SPA's CSP is set by the web server (nginx / Vite).
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // Run after the session hook so that per-user keys are available.
    hook: 'preHandler',
    keyGenerator: (req) => req.user?.id ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Retry in ${ctx.after}`,
    }),
  });

  registerSessionHooks(app, deps);

  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, details: err.details });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (status < 500) {
      return reply.code(status).send({ error: (err as FastifyError).code ?? 'bad_request', message: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));

  app.get('/api/health', async () => {
    await deps.db.execute(sql`select 1`);
    return { ok: true };
  });

  await authRoutes(app, deps);
  await meRoutes(app, deps);
  await listRoutes(app, deps);
  await invitationRoutes(app, deps);
  await actionRoutes(app, deps);
  await eventRoutes(app, deps);

  return app;
}
