import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actionInput, createTestContext, newUser, type Client, type TestContext } from './helpers';

let ctx: TestContext;
let u: Client;
let listId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  u = await newUser(ctx, 'Marta');
  listId = await u.firstListId();
});
afterAll(async () => ctx.close());

describe('action CRUD', () => {
  it('creates, reads, updates and deletes', async () => {
    const res = await u.post(
      '/api/actions',
      actionInput(listId, { notes: 'Solo il basilico', category: 'Piante' }),
    );
    expect(res.statusCode).toBe(201);
    const a = res.json();
    expect(a).toMatchObject({
      title: 'Innaffiare le piante',
      dueAt: '2025-06-12T07:00:00.000Z',
      anchorAt: '2025-06-12T07:00:00.000Z',
      effectiveDueAt: '2025-06-12T07:00:00.000Z',
      snoozedUntil: null,
      status: 'active',
      category: 'Piante',
    });

    const upd = await u.patch(`/api/actions/${a.id}`, {
      title: 'Innaffiare tutto',
      intervalValue: 2,
    });
    expect(upd.json()).toMatchObject({ title: 'Innaffiare tutto', intervalValue: 2 });

    expect((await u.patch(`/api/actions/${a.id}`, {})).statusCode).toBe(400);
    expect((await u.patch(`/api/actions/${a.id}`, { intervalUnit: 'minute' })).statusCode).toBe(
      400,
    );

    expect((await u.del(`/api/actions/${a.id}`)).statusCode).toBe(204);
    expect((await u.get(`/api/actions/${a.id}`)).statusCode).toBe(404);
  });

  it('rejects an invalid payload', async () => {
    const res = await u.post(
      '/api/actions',
      actionInput(listId, { title: '<b>' + 'x'.repeat(200), timezone: 'X/Y' }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('reschedules with nextDueAt (resets anchor and snooze)', async () => {
    const a = (await u.post('/api/actions', actionInput(listId))).json();
    await u.post(`/api/actions/${a.id}/snooze`, { until: '2025-06-13T07:00:00Z' });
    const r = (await u.patch(`/api/actions/${a.id}`, { nextDueAt: '2025-07-01T08:00:00Z' })).json();
    expect(r).toMatchObject({
      anchorAt: '2025-07-01T08:00:00.000Z',
      dueAt: '2025-07-01T08:00:00.000Z',
      snoozedUntil: null,
    });
  });
});

describe('main flow: create → overdue → done → rescheduled', () => {
  it('fixed schedule weekly, completed late, skips to next grid slot', async () => {
    ctx.clock.set('2025-06-10T10:00:00Z');
    const a = (await u.post('/api/actions', actionInput(listId, { title: 'Pulizie' }))).json();
    // Time passes: overdue by ~9 days (Saturday 21st).
    ctx.clock.set('2025-06-21T10:00:00Z');
    const overdue = (await u.get('/api/actions')).json().find((x: { id: string }) => x.id === a.id);
    expect(new Date(overdue.effectiveDueAt).getTime()).toBeLessThan(ctx.clock.now().getTime());

    const done = await u.post(`/api/actions/${a.id}/complete`, { expectedDueAt: a.effectiveDueAt });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      dueAt: '2025-06-26T07:00:00.000Z', // next Thursday 09:00 Rome
      lastCompletedAt: '2025-06-21T10:00:00.000Z',
      lastCompletedBy: { displayName: 'Marta' },
    });
  });

  it('from_completion: next = completion + interval', async () => {
    ctx.clock.set('2025-06-10T10:00:00Z');
    const a = (
      await u.post(
        '/api/actions',
        actionInput(listId, {
          title: 'Pile',
          mode: 'from_completion',
          intervalValue: 6,
          intervalUnit: 'month',
        }),
      )
    ).json();
    ctx.clock.set('2025-06-15T16:30:00Z');
    const done = (await u.post(`/api/actions/${a.id}/complete`, {})).json();
    // 18:30 CEST + 6 months = 18:30 CET (local wall-clock time is kept across DST).
    expect(done.dueAt).toBe('2025-12-15T17:30:00.000Z');
  });

  it('accepts an explicit past completion time but not a future one', async () => {
    ctx.clock.set('2025-06-20T10:00:00Z');
    const a = (
      await u.post(
        '/api/actions',
        actionInput(listId, { mode: 'from_completion', intervalUnit: 'day', intervalValue: 3 }),
      )
    ).json();
    const future = await u.post(`/api/actions/${a.id}/complete`, {
      completedAt: '2025-06-21T10:00:00Z',
    });
    expect(future.statusCode).toBe(400);
    const past = await u.post(`/api/actions/${a.id}/complete`, {
      completedAt: '2025-06-19T10:00:00Z',
    });
    expect(past.json().dueAt).toBe('2025-06-22T10:00:00.000Z');
  });

  it('detects a concurrent completion (stale occurrence)', async () => {
    ctx.clock.set('2025-06-20T10:00:00Z');
    const a = (
      await u.post('/api/actions', actionInput(listId, { firstDueAt: '2025-06-19T07:00:00Z' }))
    ).json();
    expect(
      (await u.post(`/api/actions/${a.id}/complete`, { expectedDueAt: a.effectiveDueAt }))
        .statusCode,
    ).toBe(200);
    const second = await u.post(`/api/actions/${a.id}/complete`, {
      expectedDueAt: a.effectiveDueAt,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('stale_occurrence');
  });
});

describe('snooze', () => {
  it('moves only the current occurrence and keeps the rule', async () => {
    ctx.clock.set('2025-06-12T08:00:00Z');
    const a = (await u.post('/api/actions', actionInput(listId))).json(); // due Jun 12 07:00Z
    const s = await u.post(`/api/actions/${a.id}/snooze`, { until: '2025-06-13T07:00:00Z' });
    expect(s.json()).toMatchObject({
      dueAt: '2025-06-12T07:00:00.000Z',
      snoozedUntil: '2025-06-13T07:00:00.000Z',
      effectiveDueAt: '2025-06-13T07:00:00.000Z',
    });
    ctx.clock.set('2025-06-13T07:10:00Z');
    const done = (await u.post(`/api/actions/${a.id}/complete`, {})).json();
    expect(done).toMatchObject({ dueAt: '2025-06-19T07:00:00.000Z', snoozedUntil: null });
    const events = (await u.get(`/api/actions/${a.id}/events`)).json();
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'completed',
      'snoozed',
      'created',
    ]);
  });

  it('rejects snoozing into the past', async () => {
    const a = (await u.post('/api/actions', actionInput(listId))).json();
    const res = await u.post(`/api/actions/${a.id}/snooze`, { until: '2020-01-01T00:00:00Z' });
    expect(res.statusCode).toBe(400);
  });
});

describe('pause / archive', () => {
  it('paused actions cannot be completed and archived ones are hidden by default', async () => {
    const a = (
      await u.post('/api/actions', actionInput(listId, { title: 'Scadenza bollo' }))
    ).json();
    await u.patch(`/api/actions/${a.id}`, { status: 'paused' });
    expect((await u.post(`/api/actions/${a.id}/complete`, {})).statusCode).toBe(409);
    await u.patch(`/api/actions/${a.id}`, { status: 'archived' });
    const ids = (await u.get('/api/actions')).json().map((x: { id: string }) => x.id);
    expect(ids).not.toContain(a.id);
    const archived = (await u.get('/api/actions?status=archived'))
      .json()
      .map((x: { id: string }) => x.id);
    expect(archived).toContain(a.id);
  });
});

describe('filters and calendar', () => {
  it('filters by category and assignee', async () => {
    const other = await newUser(ctx, 'Filtro');
    const l = await other.firstListId();
    await other.post('/api/actions', actionInput(l, { title: 'A', category: 'Casa' }));
    await other.post(
      '/api/actions',
      actionInput(l, { title: 'B', category: 'Auto', assigneeId: other.user!.id }),
    );
    expect(
      (await other.get('/api/actions?category=Casa')).json().map((a: { title: string }) => a.title),
    ).toEqual(['A']);
    expect(
      (await other.get('/api/actions?assigneeId=me')).json().map((a: { title: string }) => a.title),
    ).toEqual(['B']);
    expect(
      (await other.get('/api/actions?assigneeId=none'))
        .json()
        .map((a: { title: string }) => a.title),
    ).toEqual(['A']);
    expect((await other.get('/api/categories')).json()).toEqual(['Auto', 'Casa']);
  });

  it('projects occurrences and marks overdue / planned / completed', async () => {
    const cal = await newUser(ctx, 'Calendario');
    const l = await cal.firstListId();
    ctx.clock.set('2025-06-01T08:00:00Z');
    const a = (
      await cal.post(
        '/api/actions',
        actionInput(l, { title: 'Settimanale', firstDueAt: '2025-06-02T07:00:00Z' }),
      )
    ).json();
    ctx.clock.set('2025-06-02T10:00:00Z');
    await cal.post(`/api/actions/${a.id}/complete`, {}); // completes Jun 2 → next Jun 9
    ctx.clock.set('2025-06-10T10:00:00Z'); // Jun 9 is now overdue

    const res = await cal.get('/api/calendar?from=2025-06-01T00:00:00Z&to=2025-06-30T00:00:00Z');
    expect(res.statusCode).toBe(200);
    const occ = res
      .json()
      .map((o: { at: string; status: string; current: boolean }) => [o.at, o.status, o.current]);
    expect(occ).toEqual([
      ['2025-06-02T10:00:00.000Z', 'completed', false],
      ['2025-06-09T07:00:00.000Z', 'overdue', true],
      ['2025-06-16T07:00:00.000Z', 'planned', false],
      ['2025-06-23T07:00:00.000Z', 'planned', false],
    ]);
    expect(res.json()[0].completedBy.displayName).toBe('Calendario');
  });

  it('rejects oversized calendar ranges', async () => {
    const res = await u.get('/api/calendar?from=2025-01-01T00:00:00Z&to=2025-12-31T00:00:00Z');
    expect(res.statusCode).toBe(400);
  });
});
