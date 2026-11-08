import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actionInput, Client, createTestContext, newUser, type TestContext } from './helpers';

/**
 * Authorization matrix: a user must never be able to read or write lists
 * (and their actions) they are not a member of; editors cannot perform
 * owner-only operations.
 */
let ctx: TestContext;
let alice: Client; // owner of "Casa"
let bob: Client; // stranger, later editor
let listId: string;
let actionId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  alice = await newUser(ctx, 'Alice');
  bob = await newUser(ctx, 'Bob');
  listId = (await alice.post('/api/lists', { name: 'Casa' })).json().id;
  actionId = (await alice.post('/api/actions', actionInput(listId, { category: 'Piante' }))).json().id;
});
afterAll(async () => ctx.close());

describe('non-members', () => {
  it('cannot read the list, its members or its actions', async () => {
    expect((await bob.get(`/api/lists/${listId}`)).statusCode).toBe(404);
    expect((await bob.get(`/api/lists/${listId}/members`)).statusCode).toBe(404);
    expect((await bob.get(`/api/lists/${listId}/invitations`)).statusCode).toBe(404);
    expect((await bob.get(`/api/actions/${actionId}`)).statusCode).toBe(404);
    expect((await bob.get(`/api/actions/${actionId}/events`)).statusCode).toBe(404);
  });

  it('do not see foreign data in collection endpoints, even when filtering by list id', async () => {
    expect((await bob.get('/api/actions')).json()).toEqual([]);
    expect((await bob.get(`/api/actions?listId=${listId}`)).json()).toEqual([]);
    expect((await bob.get('/api/categories')).json()).toEqual([]);
    const lists = (await bob.get('/api/lists')).json() as { id: string }[];
    expect(lists.map((l) => l.id)).not.toContain(listId);
    const cal = await bob.get(
      `/api/calendar?from=2025-06-01T00:00:00Z&to=2025-07-01T00:00:00Z&listId=${listId}`,
    );
    expect(cal.json()).toEqual([]);
  });

  it('cannot write to the list or its actions', async () => {
    expect((await bob.patch(`/api/lists/${listId}`, { name: 'Hacked' })).statusCode).toBe(404);
    expect((await bob.del(`/api/lists/${listId}`)).statusCode).toBe(404);
    expect((await bob.post('/api/actions', actionInput(listId))).statusCode).toBe(404);
    expect((await bob.patch(`/api/actions/${actionId}`, { title: 'Hacked' })).statusCode).toBe(404);
    expect((await bob.post(`/api/actions/${actionId}/complete`, {})).statusCode).toBe(404);
    expect(
      (await bob.post(`/api/actions/${actionId}/snooze`, { until: '2025-06-20T10:00:00Z' })).statusCode,
    ).toBe(404);
    expect((await bob.del(`/api/actions/${actionId}`)).statusCode).toBe(404);
    expect((await bob.post(`/api/lists/${listId}/invitations`, {})).statusCode).toBe(404);
    expect((await bob.del(`/api/lists/${listId}/members/${alice.user!.id}`)).statusCode).toBe(404);
  });

  it('cannot move their own action into a foreign list', async () => {
    const bobList = await bob.firstListId();
    const bobAction = (await bob.post('/api/actions', actionInput(bobList))).json().id;
    expect((await bob.patch(`/api/actions/${bobAction}`, { listId })).statusCode).toBe(404);
  });

  it('cannot be assigned to an action', async () => {
    const res = await alice.post('/api/actions', actionInput(listId, { assigneeId: bob.user!.id }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('assignee_not_member');
  });

  it('anonymous users get 401', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.get('/api/lists')).statusCode).toBe(401);
    expect((await anon.get(`/api/actions/${actionId}`)).statusCode).toBe(401);
    expect((await anon.get('/api/events/stream')).statusCode).toBe(401);
  });
});

describe('editors', () => {
  beforeAll(async () => {
    const { url } = (await alice.post(`/api/lists/${listId}/invitations`, {})).json();
    const token = url.split('/').pop();
    expect((await bob.post(`/api/invitations/${token}/accept`)).statusCode).toBe(200);
  });

  it('can read and update the shared state', async () => {
    expect((await bob.get(`/api/lists/${listId}`)).json()).toMatchObject({ role: 'editor', memberCount: 2 });
    expect((await bob.get(`/api/actions?listId=${listId}`)).json()).toHaveLength(1);
    expect((await bob.post(`/api/actions/${actionId}/complete`, {})).statusCode).toBe(200);
    const created = await bob.post('/api/actions', actionInput(listId, { title: 'Pile telecomando' }));
    expect(created.statusCode).toBe(201);
    expect((await bob.patch(`/api/actions/${created.json().id}`, { assigneeId: alice.user!.id })).statusCode).toBe(200);
  });

  it('cannot perform owner-only operations', async () => {
    expect((await bob.patch(`/api/lists/${listId}`, { name: 'Mia' })).statusCode).toBe(403);
    expect((await bob.del(`/api/lists/${listId}`)).statusCode).toBe(403);
    expect((await bob.get(`/api/lists/${listId}/invitations`)).statusCode).toBe(403);
    expect((await bob.post(`/api/lists/${listId}/invitations`, {})).statusCode).toBe(403);
    expect((await bob.del(`/api/lists/${listId}/members/${alice.user!.id}`)).statusCode).toBe(403);
    expect(
      (await bob.patch(`/api/lists/${listId}/members/${bob.user!.id}`, { role: 'owner' })).statusCode,
    ).toBe(403);
  });

  it('history shows who completed the action', async () => {
    const events = (await alice.get(`/api/actions/${actionId}/events`)).json();
    expect(events[0]).toMatchObject({ type: 'completed', user: { displayName: 'Bob' } });
  });
});

describe('membership lifecycle', () => {
  it('the last owner cannot leave or be demoted', async () => {
    const me = alice.user!.id;
    expect((await alice.del(`/api/lists/${listId}/members/${me}`)).statusCode).toBe(409);
    expect((await alice.patch(`/api/lists/${listId}/members/${me}`, { role: 'editor' })).statusCode).toBe(409);
  });

  it('the owner removes a member, who immediately loses access and their assignments', async () => {
    const carol = await newUser(ctx, 'Carol');
    const { url } = (await alice.post(`/api/lists/${listId}/invitations`, {})).json();
    await carol.post(`/api/invitations/${url.split('/').pop()}/accept`);
    const assigned = (
      await alice.post('/api/actions', actionInput(listId, { assigneeId: carol.user!.id }))
    ).json();
    expect(assigned.assignee.displayName).toBe('Carol');

    expect((await alice.del(`/api/lists/${listId}/members/${carol.user!.id}`)).statusCode).toBe(204);
    expect((await carol.get(`/api/lists/${listId}`)).statusCode).toBe(404);
    expect((await carol.get(`/api/actions/${assigned.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/actions/${assigned.id}`)).json().assignee).toBeNull();
  });

  it('a member can leave on their own', async () => {
    expect((await bob.del(`/api/lists/${listId}/members/${bob.user!.id}`)).statusCode).toBe(204);
    expect((await bob.get(`/api/actions/${actionId}`)).statusCode).toBe(404);
  });

  it('deleting a list removes its actions', async () => {
    expect((await alice.del(`/api/lists/${listId}`)).statusCode).toBe(204);
    expect((await alice.get(`/api/actions/${actionId}`)).statusCode).toBe(404);
  });
});

describe('realtime fan-out', () => {
  it('only members of a list receive its change events', async () => {
    const received: string[] = [];
    const off = ctx.realtime.subscribe((e) => received.push(e.listId));
    const dave = await newUser(ctx, 'Dave');
    const daveList = await dave.firstListId();
    await dave.post('/api/actions', actionInput(daveList));
    off();
    expect(received).toContain(daveList);
  });
});
