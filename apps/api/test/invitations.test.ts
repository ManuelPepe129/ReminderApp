import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, newUser, type Client, type TestContext } from './helpers';

let ctx: TestContext;
let owner: Client;
let listId: string;

const tokenOf = (url: string) => url.split('/').pop()!;

beforeAll(async () => {
  ctx = await createTestContext({ INVITE_RATE_LIMIT_PER_HOUR: '6' });
  owner = await newUser(ctx, 'Owner');
  listId = (await owner.post('/api/lists', { name: 'Lavoro' })).json().id;
});
afterAll(async () => ctx.close());

describe('invitations', () => {
  it('link invitations are reusable until they expire', async () => {
    const { url, invitation } = (await owner.post(`/api/lists/${listId}/invitations`, {})).json();
    expect(invitation.email).toBeNull();
    expect(url).toMatch(/^http:\/\/localhost:5173\/inviti\//);

    const preview = await (await newUser(ctx, 'Viewer')).get(`/api/invitations/${tokenOf(url)}`);
    expect(preview.json()).toMatchObject({
      listName: 'Lavoro',
      invitedBy: 'Owner',
      role: 'editor',
    });

    const a = await newUser(ctx, 'LinkA');
    const b = await newUser(ctx, 'LinkB');
    expect((await a.post(`/api/invitations/${tokenOf(url)}/accept`)).json()).toEqual({ listId });
    expect((await b.post(`/api/invitations/${tokenOf(url)}/accept`)).statusCode).toBe(200);
    // Idempotent for existing members.
    expect((await a.post(`/api/invitations/${tokenOf(url)}/accept`)).statusCode).toBe(200);
    expect((await owner.get(`/api/lists/${listId}/members`)).json()).toHaveLength(3);

    ctx.clock.advance(8 * 86_400_000);
    const late = await newUser(ctx, 'Late');
    expect((await late.post(`/api/invitations/${tokenOf(url)}/accept`)).statusCode).toBe(404);
  });

  it('e-mail invitations are sent by mail and single-use', async () => {
    const res = await owner.post(`/api/lists/${listId}/invitations`, {
      email: 'Guest@Example.com',
    });
    expect(res.statusCode).toBe(201);
    const mail = ctx.mailer.last()!;
    expect(mail.to).toBe('guest@example.com');
    expect(mail.subject).toContain('Lavoro');
    const token = tokenOf(res.json().url);
    expect(mail.text).toContain(token);

    const guest = await newUser(ctx, 'Guest');
    expect((await guest.post(`/api/invitations/${token}/accept`)).statusCode).toBe(200);
    const other = await newUser(ctx, 'Other');
    expect((await other.post(`/api/invitations/${token}/accept`)).statusCode).toBe(404);
  });

  it('revoked invitations stop working', async () => {
    const { url, invitation } = (await owner.post(`/api/lists/${listId}/invitations`, {})).json();
    const pending = (await owner.get(`/api/lists/${listId}/invitations`)).json();
    expect(pending.map((i: { id: string }) => i.id)).toContain(invitation.id);
    expect((await owner.del(`/api/lists/${listId}/invitations/${invitation.id}`)).statusCode).toBe(
      204,
    );
    const x = await newUser(ctx, 'Revoked');
    expect((await x.post(`/api/invitations/${tokenOf(url)}/accept`)).statusCode).toBe(404);
  });

  it('unknown tokens are rejected and accepting requires login', async () => {
    const x = await newUser(ctx, 'Random');
    expect((await x.get('/api/invitations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).statusCode).toBe(404);
    const { url } = (await owner.post(`/api/lists/${listId}/invitations`, {})).json();
    await x.post('/api/auth/logout');
    expect((await x.post(`/api/invitations/${tokenOf(url)}/accept`)).statusCode).toBe(401);
  });

  it('rate-limits invitation creation per user', async () => {
    // 4 invitations already created above; the limit is 6 per hour.
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await owner.post(`/api/lists/${listId}/invitations`, {})).statusCode);
    }
    expect(codes).toEqual([201, 201, 429, 429]);
  });
});
