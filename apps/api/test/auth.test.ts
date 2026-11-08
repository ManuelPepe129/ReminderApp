import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());

describe('auth', () => {
  it('registers, creates a personal list and keeps the session', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/register', {
      email: 'Anna@Example.com',
      password: 'password123',
      displayName: 'Anna',
      timezone: 'Europe/Rome',
    });
    expect(res.statusCode).toBe(201);
    const sid = res.cookies.find((k) => k.name === 'sid');
    expect(sid?.httpOnly).toBe(true);
    expect(sid?.sameSite).toBe('Lax');
    expect(res.json()).toMatchObject({ email: 'anna@example.com', displayName: 'Anna' });

    const me = await c.get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    const lists = (await c.get('/api/lists')).json();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Personale', role: 'owner', memberCount: 1 });
  });

  it('rejects duplicate e-mails', async () => {
    const res = await new Client(ctx.app).post('/api/auth/register', {
      email: 'anna@example.com',
      password: 'password123',
      displayName: 'Anna 2',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email_taken');
  });

  it('validates input', async () => {
    const res = await new Client(ctx.app).post('/api/auth/register', {
      email: 'not-an-email',
      password: 'short',
      displayName: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('logs in and out', async () => {
    const c = new Client(ctx.app);
    expect(
      (await c.post('/api/auth/login', { email: 'anna@example.com', password: 'wrong-pass' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'x' })).statusCode,
    ).toBe(401);
    const ok = await c.post('/api/auth/login', {
      email: 'ANNA@example.com',
      password: 'password123',
    });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/api/auth/me')).statusCode).toBe(200);
    expect((await c.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('requires a matching CSRF token and origin for state-changing requests', async () => {
    const c = new Client(ctx.app);
    const noToken = await c.request(
      'POST',
      '/api/auth/login',
      { email: 'anna@example.com', password: 'password123' },
      { 'x-csrf-token': 'other-value' },
    );
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error).toBe('csrf');

    const badOrigin = await c.request(
      'POST',
      '/api/auth/login',
      { email: 'anna@example.com', password: 'password123' },
      { origin: 'https://evil.example' },
    );
    expect(badOrigin.statusCode).toBe(403);
    expect(badOrigin.json().error).toBe('bad_origin');
  });

  it('signs in (and signs up) with a single-use magic link', async () => {
    const c = new Client(ctx.app);
    expect(
      (
        await c.post('/api/auth/magic-link', {
          email: 'bruno@example.com',
          redirect: '/calendario',
        })
      ).statusCode,
    ).toBe(204);
    const mail = ctx.mailer.last();
    expect(mail?.to).toBe('bruno@example.com');
    const token = /token=([\w-]+)/.exec(mail!.text)![1]!;

    const res = await c.post('/api/auth/magic-link/verify', { token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { email: 'bruno@example.com', emailVerified: true, hasPassword: false },
      redirect: '/calendario',
    });
    expect((await c.get('/api/auth/me')).statusCode).toBe(200);

    // Reuse is rejected.
    const again = await new Client(ctx.app).post('/api/auth/magic-link/verify', { token });
    expect(again.statusCode).toBe(400);
  });

  it('rejects expired magic links', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/magic-link', { email: 'carla@example.com' });
    const token = /token=([\w-]+)/.exec(ctx.mailer.last()!.text)![1]!;
    ctx.clock.advance(16 * 60_000);
    expect((await c.post('/api/auth/magic-link/verify', { token })).statusCode).toBe(400);
  });

  it('does not reveal whether an account exists', async () => {
    const res = await new Client(ctx.app).post('/api/auth/magic-link', {
      email: 'unknown@example.com',
    });
    expect(res.statusCode).toBe(204);
  });

  it('sets security headers', async () => {
    const res = await new Client(ctx.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('auth rate limiting', () => {
  it('limits login attempts', async () => {
    const limited = await createTestContext({ AUTH_RATE_LIMIT_PER_15MIN: '3' });
    try {
      const c = new Client(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push(
          (await c.post('/api/auth/login', { email: 'x@example.com', password: 'nope' }))
            .statusCode,
        );
      }
      expect(codes).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});
