import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MIGRATIONS_DIR, schema, type Db } from '../src/db';
import { MemoryMailer } from '../src/lib/mailer';
import { LocalRealtime } from '../src/lib/realtime';
import { MemoryPushSender } from '../src/notifications/push';
import type { AppDeps } from '../src/deps';

export const ORIGIN = 'http://localhost:5173';

export class Clock {
  constructor(public current: Date) {}
  now = () => new Date(this.current);
  set(d: Date | string) {
    this.current = new Date(d);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  pg: PGlite;
  deps: AppDeps;
  mailer: MemoryMailer;
  push: MemoryPushSender;
  realtime: LocalRealtime;
  clock: Clock;
  close(): Promise<void>;
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
  const mailer = new MemoryMailer();
  const push = new MemoryPushSender();
  const realtime = new LocalRealtime();
  const clock = new Clock(new Date('2025-06-10T10:00:00Z'));
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    AUTH_RATE_LIMIT_PER_15MIN: '1000',
    ...env,
  });
  const deps: AppDeps = { config, db, mailer, realtime, push, now: clock.now };
  const app = await buildApp(deps);
  await app.ready();
  return {
    app,
    db,
    pg,
    deps,
    mailer,
    push,
    realtime,
    clock,
    async close() {
      await app.close();
      await pg.close();
    },
  };
}

/** Minimal cookie-jar HTTP client around fastify.inject (handles CSRF double-submit). */
export class Client {
  private cookies = new Map<string, string>([['csrf', 'test-csrf-token-123456']]);
  user: { id: string; email: string; displayName: string } | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      ...(body !== undefined ? { payload: body as object } : {}),
      headers: {
        origin: ORIGIN,
        'x-csrf-token': this.cookies.get('csrf') ?? '',
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
    });
    for (const c of res.cookies as { name: string; value: string; expires?: Date }[]) {
      // clearCookie() sends an empty value with an expiry in 1970.
      if (c.value === '' || (c.expires && c.expires.getTime() < 1e12)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);
  del = (url: string, body?: unknown) => this.request('DELETE', url, body);

  async register(name: string, email = `${name.toLowerCase()}@example.com`) {
    const res = await this.post('/api/auth/register', {
      email,
      password: 'password123',
      displayName: name,
      timezone: 'Europe/Rome',
    });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    this.user = res.json();
    return this.user!;
  }

  async firstListId(): Promise<string> {
    const lists = (await this.get('/api/lists')).json() as { id: string }[];
    return lists[0]!.id;
  }
}

export async function newUser(ctx: TestContext, name: string): Promise<Client> {
  const c = new Client(ctx.app);
  await c.register(name);
  return c;
}

export function actionInput(listId: string, overrides: Record<string, unknown> = {}) {
  return {
    listId,
    title: 'Innaffiare le piante',
    firstDueAt: '2025-06-12T07:00:00.000Z', // 09:00 Rome
    intervalValue: 1,
    intervalUnit: 'week',
    mode: 'fixed_schedule',
    timezone: 'Europe/Rome',
    ...overrides,
  };
}
