import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notificationLog, pushSubscriptions, users } from '../src/db/schema';
import { isQuietTime, runNotificationTick } from '../src/notifications/scheduler';
import { actionInput, createTestContext, newUser, type Client, type TestContext } from './helpers';

let ctx: TestContext;
let anna: Client;
let listId: string;

async function subscribe(c: Client, endpoint: string) {
  const res = await c.post('/api/push/subscriptions', {
    endpoint,
    keys: { p256dh: 'BPx-test-key', auth: 'auth-secret' },
  });
  expect(res.statusCode).toBe(201);
}
const tick = () => runNotificationTick(ctx.deps);

beforeAll(async () => {
  ctx = await createTestContext();
  ctx.clock.set('2025-06-10T08:00:00Z');
  anna = await newUser(ctx, 'Anna');
  listId = await anna.firstListId();
  await subscribe(anna, 'https://push.example/anna-phone');
});
afterAll(async () => ctx.close());
beforeEach(() => {
  ctx.push.sent.length = 0;
  ctx.mailer.sent.length = 0;
});

describe('isQuietTime', () => {
  const at = (iso: string) => new Date(iso);
  it('handles same-day and overnight windows in the user time zone', () => {
    // 23:30 in Rome (CEST) = 21:30Z
    expect(isQuietTime(at('2025-06-10T21:30:00Z'), 'Europe/Rome', '22:00', '07:00')).toBe(true);
    expect(isQuietTime(at('2025-06-10T04:59:00Z'), 'Europe/Rome', '22:00', '07:00')).toBe(true);
    expect(isQuietTime(at('2025-06-10T05:00:00Z'), 'Europe/Rome', '22:00', '07:00')).toBe(false);
    // 11:00Z = 13:00 in Rome
    expect(isQuietTime(at('2025-06-10T11:00:00Z'), 'Europe/Rome', '12:00', '14:00')).toBe(true);
    expect(isQuietTime(at('2025-06-10T11:00:00Z'), 'Europe/Rome', '13:30', '14:00')).toBe(false);
    expect(isQuietTime(at('2025-06-10T11:00:00Z'), 'Europe/Rome', null, null)).toBe(false);
  });
});

describe('notification worker', () => {
  it('sends a push when an action becomes due, exactly once', async () => {
    await anna.post(
      '/api/actions',
      actionInput(listId, { title: 'Innaffiare', firstDueAt: '2025-06-10T09:00:00Z' }),
    );
    expect((await tick()).sent).toBe(0); // not due yet

    ctx.clock.set('2025-06-10T09:00:30Z');
    const r = await tick();
    expect(r.push).toBe(1);
    expect(ctx.push.sent[0]!.payload).toMatchObject({ title: 'Scaduta: Innaffiare' });
    expect(ctx.push.sent[0]!.payload.url).toMatch(/^\/azioni\//);
    expect(ctx.mailer.sent).toHaveLength(0); // push delivered → no e-mail fallback

    // Subsequent ticks (or concurrent workers) never resend it.
    await Promise.all([tick(), tick()]);
    expect(ctx.push.sent).toHaveLength(1);
  });

  it('notifies again for the next occurrence after completion', async () => {
    const a = (await anna.get('/api/actions'))
      .json()
      .find((x: { title: string }) => x.title === 'Innaffiare');
    await anna.post(`/api/actions/${a.id}/complete`, {});
    ctx.clock.set('2025-06-17T09:01:00Z');
    await tick();
    expect(ctx.push.sent.map((s) => s.payload.title)).toEqual(['Scaduta: Innaffiare']);
  });

  it('a snooze creates a new due notification at the new time', async () => {
    const a = (await anna.get('/api/actions'))
      .json()
      .find((x: { title: string }) => x.title === 'Innaffiare');
    await anna.post(`/api/actions/${a.id}/snooze`, { until: '2025-06-17T12:00:00Z' });
    await tick();
    expect(ctx.push.sent).toHaveLength(0);
    ctx.clock.set('2025-06-17T12:00:10Z');
    await tick();
    expect(ctx.push.sent).toHaveLength(1);
    await anna.post(`/api/actions/${a.id}/complete`, {});
  });

  it('sends the advance notice (lead time) before the due date', async () => {
    ctx.clock.set('2025-06-20T08:00:00Z');
    await anna.post(
      '/api/actions',
      actionInput(listId, {
        title: 'Bollo auto',
        firstDueAt: '2025-06-21T08:00:00Z',
        leadMinutes: 1440,
        intervalUnit: 'year',
      }),
    );
    await tick();
    expect(ctx.push.sent.map((s) => s.payload.title)).toEqual(['In arrivo: Bollo auto']);
    ctx.clock.set('2025-06-21T08:00:05Z');
    await tick();
    expect(ctx.push.sent.map((s) => s.payload.title)).toEqual([
      'In arrivo: Bollo auto',
      'Scaduta: Bollo auto',
    ]);
  });

  it('falls back to e-mail when the user has no push subscription', async () => {
    const bruno = await newUser(ctx, 'Bruno');
    const l = await bruno.firstListId();
    ctx.clock.set('2025-06-22T07:00:00Z');
    await bruno.post(
      '/api/actions',
      actionInput(l, { title: 'Pile', firstDueAt: '2025-06-22T07:30:00Z' }),
    );
    ctx.clock.set('2025-06-22T07:31:00Z');
    const r = await tick();
    expect(r.email).toBe(1);
    expect(ctx.mailer.last()).toMatchObject({ to: 'bruno@example.com', subject: 'Scaduta: Pile' });
  });

  it('respects quiet hours (deferred, then delivered) and channel preferences', async () => {
    const carla = await newUser(ctx, 'Carla');
    const l = await carla.firstListId();
    await carla.patch('/api/me/preferences', {
      quietStart: '22:00',
      quietEnd: '07:00',
      emailEnabled: false,
    });
    await subscribe(carla, 'https://push.example/carla');
    ctx.clock.set('2025-06-22T19:00:00Z');
    await carla.post(
      '/api/actions',
      actionInput(l, { title: 'Notturna', firstDueAt: '2025-06-22T21:00:00Z' }),
    );

    ctx.clock.set('2025-06-22T21:05:00Z'); // 23:05 in Rome: quiet
    const quiet = await tick();
    expect(quiet.deferred).toBeGreaterThan(0);
    expect(ctx.push.sent.filter((s) => s.target.endpoint.endsWith('carla'))).toHaveLength(0);

    ctx.clock.set('2025-06-23T05:01:00Z'); // 07:01 in Rome
    await tick();
    expect(ctx.push.sent.filter((s) => s.target.endpoint.endsWith('carla'))).toHaveLength(1);
    expect(ctx.mailer.sent.filter((m) => m.to === 'carla@example.com')).toHaveLength(0);
  });

  it('notifies only the assignee when set, otherwise every member', async () => {
    const owner = await newUser(ctx, 'Owner');
    const member = await newUser(ctx, 'Member');
    const shared = (await owner.post('/api/lists', { name: 'Casa condivisa' })).json().id;
    const { url } = (await owner.post(`/api/lists/${shared}/invitations`, {})).json();
    await member.post(`/api/invitations/${url.split('/').pop()}/accept`);
    ctx.clock.set('2025-06-24T08:00:00Z');
    await owner.post(
      '/api/actions',
      actionInput(shared, { title: 'Tutti', firstDueAt: '2025-06-24T08:10:00Z' }),
    );
    await owner.post(
      '/api/actions',
      actionInput(shared, {
        title: 'Solo member',
        firstDueAt: '2025-06-24T08:10:00Z',
        assigneeId: member.user!.id,
      }),
    );
    ctx.clock.set('2025-06-24T08:11:00Z');
    await tick();
    const mails = ctx.mailer.sent.map((m) => `${m.to}:${m.subject}`).sort();
    expect(mails).toEqual([
      'member@example.com:Scaduta: Solo member',
      'member@example.com:Scaduta: Tutti',
      'owner@example.com:Scaduta: Tutti',
    ]);
  });

  it('removes expired push subscriptions', async () => {
    ctx.push.goneEndpoints.add('https://push.example/anna-phone');
    ctx.clock.set('2025-06-25T08:00:00Z');
    await anna.post(
      '/api/actions',
      actionInput(listId, { title: 'Gone', firstDueAt: '2025-06-25T08:01:00Z' }),
    );
    ctx.clock.set('2025-06-25T08:02:00Z');
    await tick();
    const subs = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, anna.user!.id));
    expect(subs).toHaveLength(0);
    // …and the e-mail fallback kicked in.
    expect(ctx.mailer.last()?.subject).toBe('Scaduta: Gone');
  });

  it('does not notify paused actions or very old occurrences', async () => {
    const dora = await newUser(ctx, 'Dora');
    const l = await dora.firstListId();
    ctx.clock.set('2025-06-26T08:00:00Z');
    const paused = (
      await dora.post(
        '/api/actions',
        actionInput(l, { title: 'Pausa', firstDueAt: '2025-06-26T08:01:00Z' }),
      )
    ).json();
    await dora.patch(`/api/actions/${paused.id}`, { status: 'paused' });
    await dora.post(
      '/api/actions',
      actionInput(l, { title: 'Antica', firstDueAt: '2025-06-01T08:00:00Z' }),
    );
    ctx.clock.set('2025-06-26T08:05:00Z');
    await tick();
    expect(ctx.mailer.sent.filter((m) => m.to === 'dora@example.com')).toHaveLength(0);
    const [d] = await ctx.db.select().from(users).where(eq(users.email, 'dora@example.com'));
    const logs = await ctx.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.userId, d!.id));
    expect(logs).toHaveLength(0);
  });
});
